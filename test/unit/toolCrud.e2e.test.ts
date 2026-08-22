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
  const toolMap = new Map<string, any>();
  const seen = new Set<string>();
  const d: any = {
    hosts: {
      create: async (i: any) => { const id = `host-${++seq}`; const r = { id, ...i, thumb: jwkThumbprint(i.publicKeyJwk), createdAt: new Date(), updatedAt: new Date() }; hosts.set(id, r); return r; },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async () => {},
    },
    agents: { findById: async () => null, findBySubject: async () => null, list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
    projects: { list: async () => [] },
    tools: {
      upsert: async (i: any) => { const r = { id: `tool-${++seq}`, name: i.name, adapterType: i.adapterType, adapterConfig: i.adapterConfig, schemaCache: null, schemaCachedAt: null }; toolMap.set(i.name, r); return r; },
      findByName: async (n: string) => toolMap.get(n) ?? null,
      list: async () => ({ items: [...toolMap.values()], hasMore: false, nextCursor: null }),
      cacheSchema: async () => {},
      delete: async (n: string) => toolMap.delete(n),
    },
    capabilityGrants: { findForAgent: async () => [] },
    tasks: { list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
    connections: { list: async () => ({ items: [], hasMore: false, nextCursor: null }), findById: async () => null },
    connectionGrants: { listByAgent: async () => [] },
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
const req = (method: string, path: string, token: string | null, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe('tool registry CRUD (host-authorized)', () => {
  it('registers a tool, then lists it with its adapter config', async () => {
    const res = await req('POST', '/tools', await hostJwt(), {
      name: 'get_weather',
      adapter_type: 'mcp',
      adapter_config: { tool: { name: 'get_weather', inputSchema: { type: 'object' } } },
    });
    assert.equal(res.status, 201);
    const list = (await (await req('GET', '/tools', null)).json()) as any;
    const tool = list.tools.find((t: any) => t.name === 'get_weather');
    assert.ok(tool, 'tool appears in the listing');
    assert.equal(tool.adapter_type, 'mcp');
    assert.deepEqual(tool.adapter_config.tool.inputSchema, { type: 'object' });
  });

  it('updates a tool by re-registering the same name', async () => {
    const res = await req('POST', '/tools', await hostJwt(), {
      name: 'get_weather',
      adapter_type: 'cli',
      adapter_config: { command: 'weather' },
    });
    assert.equal(res.status, 201);
    const list = (await (await req('GET', '/tools', null)).json()) as any;
    const tool = list.tools.find((t: any) => t.name === 'get_weather');
    assert.equal(tool.adapter_type, 'cli'); // updated in place (upsert)
  });

  it('rejects a write without a host JWT', async () => {
    assert.equal((await req('DELETE', '/tools/get_weather', null)).status, 401);
  });

  it('deletes a tool', async () => {
    const del = await req('DELETE', '/tools/get_weather', await hostJwt());
    assert.equal(del.status, 200);
    const list = (await (await req('GET', '/tools', null)).json()) as any;
    assert.equal(list.tools.find((t: any) => t.name === 'get_weather'), undefined);
  });

  it('404s when deleting a missing tool', async () => {
    assert.equal((await req('DELETE', '/tools/nope', await hostJwt())).status, 404);
  });

  it('flushes the schema cache', async () => {
    const res = await req('POST', '/tools/flush', await hostJwt());
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).flushed, true);
  });
});
