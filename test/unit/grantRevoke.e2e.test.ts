import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
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

const BASE = 'http://conduit.test';
const signer = createJwtSigner();
let jti = 0;
let seq = 0;

function inMemoryStorage() {
  const hosts = new Map<string, any>();
  const agents = new Map<string, any>();
  const grants = new Map<string, any>();
  const connMap = new Map<string, any>();
  const seen = new Set<string>();
  const d: any = {
    hosts: {
      create: async (i: any) => { const id = `host-${++seq}`; const r = { id, ...i, thumb: jwkThumbprint(i.publicKeyJwk), createdAt: new Date(), updatedAt: new Date() }; hosts.set(id, r); return r; },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async () => {},
    },
    agents: {
      create: async (i: any) => { const id = `agent-${++seq}`; const r = { id, ...i, activatedAt: null, sessionExpiresAt: null, maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date() }; agents.set(id, r); return r; },
      findById: async (id: string) => agents.get(id) ?? null,
      findBySubject: async (s: string) => agents.get(s) ?? null,
      list: async () => ({ items: [...agents.values()], hasMore: false, nextCursor: null }),
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    projects: { list: async () => [] },
    capabilityGrants: {
      upsert: async (i: any) => { for (const [k, g] of grants) if (g.agentId === i.agentId && g.capability === i.capability) grants.delete(k); const id = `grant-${++seq}`; const r = { id, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(id, r); return r; },
      findActive: async (a: string, c: string) => [...grants.values()].find((g) => g.agentId === a && g.capability === c && g.status === 'active') ?? null,
      findForAgent: async (a: string) => [...grants.values()].filter((g) => g.agentId === a),
      setStatus: async (id: string, status: string, deniedBy: string | null, reason: string | null) => { const g = grants.get(id); if (g) { g.status = status; g.deniedBy = deniedBy; g.reason = reason; } },
      revokeAllForAgent: async () => {}, revokeByTask: async () => {},
    },
    tasks: { create: async () => ({}), findById: async () => null, list: async () => ({ items: [], hasMore: false, nextCursor: null }), setStatus: async () => {} },
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const r = { id, ...i, createdAt: new Date() }; connMap.set(id, r); return r; },
      findById: async (id: string) => connMap.get(id) ?? null,
      getEncryptedCredential: async (id: string) => connMap.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...connMap.values()], hasMore: false, nextCursor: null }),
    },
    connectionGrants: { listByAgent: async () => [], upsert: async (g: any) => g, findForAgent: async () => null, delete: async () => {} },
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
  const storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;
  const cipher = createCredentialCipher(randomBytes(32));
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const cache = createSchemaCache(3600);
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage, logger: createLogger('error'),
    identityService: createIdentityService({ storage, stateMachine, verifier, issuer: BASE, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 9999, absoluteLifetimeSeconds: 9999 } }),
    connectionRegistry: createConnectionRegistryService(storage, cipher, createConnectorRegistry([])),
    connectionProxy: createConnectionProxy({ storage, cipher, connectors: createConnectorRegistry([]) }),
    tokenRouter: createTokenRouter({ storage, adapters: { get: () => undefined, register: () => {} } as never, cache, metrics: createMetrics() }),
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
const post = (path: string, token: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('capability grant revoke (per-capability kill-switch)', () => {
  let agentKp: any;
  let agentId = '';
  const agentJwt = () => signer.sign('agent+jwt', claims({ iss: issuer, sub: agentId }) as never, agentKp.privateKeyJwk);

  it('grants a capability and executes successfully', async () => {
    const conn = ((await (await post('/connections', await hostJwt(), { name: 'mock', platform: 'mock', secret: { token: 'x' }, allowed_operations: ['echo'] })).json()) as any).connection_id;
    agentKp = generateEd25519KeyPair();
    agentId = ((await (await post('/agent/register', await hostJwt(), { agent_public_key: agentKp.publicKeyJwk, mode: 'delegated' })).json()) as any).agent_id;
    await post('/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'ping', connection_id: conn, operation: 'echo', constraints: {} });
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'ping', args: { hi: 1 } })).status, 200);
  });

  it('revokes the grant, and the next execute is denied (403)', async () => {
    const res = await post('/agent/grant/revoke', await hostJwt(), { agent_id: agentId, capability: 'ping' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).status, 'denied');
    const exec = await post('/capability/execute', await agentJwt(), { capability: 'ping', args: { hi: 1 } });
    assert.equal(exec.status, 403); // grant is gone -> capability_not_granted
  });

  it('404s when revoking a capability the agent does not have', async () => {
    assert.equal((await post('/agent/grant/revoke', await hostJwt(), { agent_id: agentId, capability: 'nope' })).status, 404);
  });
});
