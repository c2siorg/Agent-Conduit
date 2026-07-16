import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createAdapterRegistry } from '../../packages/adapters/src/adapterRegistry.ts';
import { createConnectorRegistry } from '../../packages/connectors/src/connectorRegistry.ts';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';
import { createJwtSigner } from '../../packages/crypto/src/jwtSigner.ts';
import { createJwtVerifier } from '../../packages/crypto/src/jwtVerifier.ts';
import { buildAgentPipeline, buildHostPipeline } from '../../apps/server/src/auth/stages/index.ts';
import { createConnectionProxy } from '../../apps/server/src/connections/connectionProxy.ts';
import { createConnectionRegistryService } from '../../apps/server/src/connections/connectionRegistry.ts';
import { createCredentialCipher } from '../../apps/server/src/connections/credentialCipher.ts';
import { createConstraintEngine } from '../../apps/server/src/identity/constraintEngine.ts';
import { createIdentityService } from '../../apps/server/src/identity/identityService.ts';
import { createStateMachine } from '../../apps/server/src/identity/stateMachine.ts';
import { createLogger } from '../../apps/server/src/observability/logger.ts';
import { createMetrics } from '../../apps/server/src/observability/metrics.ts';
import { createSecurityEventStream } from '../../apps/server/src/observability/securityEventStream.ts';
import { createSchemaCache } from '../../apps/server/src/router/schemaCache.ts';
import { createTokenRouter } from '../../apps/server/src/router/tokenRouter.ts';
import { createGatewayApp } from '../../apps/server/src/server/gatewayApp.ts';
import { createRuntimeSettings } from '../../apps/server/src/server/runtimeSettings.ts';

const BASE = 'http://conduit.test';
const signer = createJwtSigner();
let jti = 0;
let seq = 0;

function storageStub() {
  const hosts = new Map<string, any>();
  const seen = new Set<string>();
  const d: any = {
    hosts: {
      create: async (i: any) => { const id = `host-${++seq}`; const r = { id, ...i, thumb: jwkThumbprint(i.publicKeyJwk), createdAt: new Date(), updatedAt: new Date() }; hosts.set(id, r); return r; },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async () => {},
    },
    agents: { list: async () => ({ items: [], hasMore: false, nextCursor: null }), findBySubject: async () => null, findById: async () => null },
    capabilityGrants: { findActive: async () => null, findForAgent: async () => [] },
    tools: { list: async () => ({ items: [], hasMore: false, nextCursor: null }), findByName: async () => null },
    connections: { list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
    auditLog: { append: async () => {}, query: async () => ({ items: [], hasMore: false, nextCursor: null }), recordSecurityEvent: async () => {} },
    jtiCache: { put: async (j: string) => (seen.has(j) ? false : (seen.add(j), true)) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(d),
    healthCheck: async () => true,
  };
  return d;
}

const claims = (extra: Record<string, unknown>) => {
  const now = Math.floor(Date.now() / 1000);
  return { aud: BASE, iat: now, exp: now + 60, jti: `jti-${++jti}`, ...extra };
};

let server: any;
let base = '';
let hostKp: any;
let issuer = '';

before(async () => {
  const storage = storageStub();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;
  const cipher = createCredentialCipher(randomBytes(32));
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const cache = createSchemaCache(3600);
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  // Start with enforcement off; the test enables it via PATCH.
  const settings = createRuntimeSettings({
    rateLimit: { enabled: false, perIpPerMinute: 1, registerPerHourPerIp: 100 },
    ipFilter: { enabled: false, mode: 'deny', entries: [] },
    jwks: { allowPrivateHosts: false },
    dpop: { enabled: false },
    mtls: { enabled: false },
  });
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage, logger: createLogger('error'),
    identityService: createIdentityService({ storage, stateMachine, verifier, issuer: BASE, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 9999, absoluteLifetimeSeconds: 9999 } }),
    connectionRegistry: createConnectionRegistryService(storage, cipher),
    connectionProxy: createConnectionProxy({ storage, cipher, connectors: createConnectorRegistry([]) }),
    settings,
    tokenRouter: createTokenRouter({ storage, adapters: createAdapterRegistry(), cache, metrics: createMetrics() }),
    schemaCache: cache, events: createSecurityEventStream(), metrics: createMetrics(),
    agentPipeline: buildAgentPipeline({ verifier, storage, constraintEngine, config: pc }),
    hostPipeline: buildHostPipeline({ verifier, storage, constraintEngine, config: pc }),
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

const hostJwt = () => signer.sign('host+jwt', claims({ iss: issuer }) as never, hostKp.privateKeyJwk);
const patch = async (body: unknown) =>
  fetch(`${base}/admin/config`, { method: 'PATCH', headers: { authorization: `Bearer ${await hostJwt()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('runtime security settings via /admin/config', () => {
  it('reads settings (host-authorized) and rejects unauthenticated reads', async () => {
    assert.equal((await fetch(`${base}/admin/config`)).status, 401);
    const res = await fetch(`${base}/admin/config`, { headers: { authorization: `Bearer ${await hostJwt()}` } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { rateLimit: { enabled: boolean } }).rateLimit.enabled, false);
  });

  // IP filter first (while the rate limit is still off, so these PATCHes aren't themselves limited).
  it('an IP deny rule blocks the client immediately', async () => {
    await patch({ ipFilter: { enabled: true, mode: 'deny', entries: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] } });
    assert.equal((await fetch(`${base}/agents`)).status, 403);
    await patch({ ipFilter: { enabled: false } }); // lifting restores access
    assert.equal((await fetch(`${base}/agents`)).status, 200);
  });

  it('enabling the rate limit takes effect immediately (429 + Retry-After)', async () => {
    await patch({ rateLimit: { enabled: true, perIpPerMinute: 1 } });
    assert.equal((await fetch(`${base}/agents`)).status, 200); // count 1
    const blocked = await fetch(`${base}/agents`); // count 2 > 1
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });
});
