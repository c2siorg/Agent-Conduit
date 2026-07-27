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
  const cgrants = new Map<string, any>(); // key = `${agentId}:${connectionId}`
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
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    capabilityGrants: {
      upsert: async (i: any) => { for (const [k, g] of grants) if (g.agentId === i.agentId && g.capability === i.capability) grants.delete(k); const id = `grant-${++seq}`; const r = { id, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(id, r); return r; },
      findActive: async (a: string, c: string) => [...grants.values()].find((g) => g.agentId === a && g.capability === c && g.status === 'active') ?? null,
      findForAgent: async (a: string) => [...grants.values()].filter((g) => g.agentId === a),
      setStatus: async () => {}, revokeAllForAgent: async () => {}, revokeByTask: async () => {},
    },
    tasks: { create: async () => ({}), findById: async () => null, list: async () => ({ items: [], hasMore: false, nextCursor: null }), setStatus: async () => {} },
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const r = { id, ...i, createdAt: new Date() }; connMap.set(id, r); return r; },
      findById: async (id: string) => connMap.get(id) ?? null,
      getEncryptedCredential: async (id: string) => connMap.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...connMap.values()], hasMore: false, nextCursor: null }),
    },
    connectionGrants: {
      upsert: async (g: any) => { const rec = { id: `cg-${++seq}`, ...g }; cgrants.set(`${g.agentId}:${g.connectionId}`, rec); return rec; },
      findForAgent: async (a: string, c: string) => cgrants.get(`${a}:${c}`) ?? null,
      listByAgent: async (a: string) => [...cgrants.values()].filter((g) => g.agentId === a),
      delete: async (a: string, c: string) => { cgrants.delete(`${a}:${c}`); },
    },
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

describe('agent ↔ connector authorization (connection grants)', () => {
  let kp: any;
  let agentId = '';
  let connA = '';
  let connB = '';
  const agentJwt = () => signer.sign('agent+jwt', claims({ iss: issuer, sub: agentId }) as never, kp.privateKeyJwk);

  it('registers an agent + two mock connections + capabilities on each', async () => {
    kp = generateEd25519KeyPair();
    agentId = ((await (await post('/agent/register', await hostJwt(), { agent_public_key: kp.publicKeyJwk, mode: 'delegated' })).json()) as any).agent_id;
    // Register with a broader op set so per-agent scoping to a subset validates ('post' is a valid op here).
    connA = ((await (await post('/connections', await hostJwt(), { name: 'mockA', platform: 'mock', secret: { token: 'x' }, allowed_operations: ['echo', 'post'] })).json()) as any).connection_id;
    connB = ((await (await post('/connections', await hostJwt(), { name: 'mockB', platform: 'mock', secret: { token: 'x' }, allowed_operations: ['echo', 'post'] })).json()) as any).connection_id;
    await post('/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'useA', connection_id: connA, operation: 'echo', constraints: {} });
    await post('/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'useB', connection_id: connB, operation: 'echo', constraints: {} });
  });

  it('with NO connector authorizations, both capabilities work (backward compatible)', async () => {
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 200);
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useB', args: {} })).status, 200);
  });

  it('attaching ONLY connection A makes connection B unauthorized (403)', async () => {
    const res = await post(`/agents/${agentId}/connections`, await hostJwt(), { connection_id: connA });
    assert.equal(res.status, 201);
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 200);
    const denied = await post('/capability/execute', await agentJwt(), { capability: 'useB', args: {} });
    assert.equal(denied.status, 403); // B not attached
  });

  it('lists the agent’s authorized connectors', async () => {
    const body = (await (await fetch(`${base}/agents/${agentId}/connections`)).json()) as { connections: Array<{ connection_id: string; name: string }> };
    assert.equal(body.connections.length, 1);
    assert.equal(body.connections[0]?.name, 'mockA');
  });

  it('a scoped operation set on the authorization blocks other operations', async () => {
    // Restrict connection A to only "post" — "echo" (what the grant uses) is now blocked.
    await post(`/agents/${agentId}/connections`, await hostJwt(), { connection_id: connA, allowed_operations: ['post'] });
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 403);
    // Reset to all ops.
    await post(`/agents/${agentId}/connections`, await hostJwt(), { connection_id: connA, allowed_operations: [] });
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 200);
  });

  it('enforces the per-connection rate limit (429 after the cap)', async () => {
    await post(`/agents/${agentId}/connections`, await hostJwt(), { connection_id: connA, allowed_operations: [], rate_limit: 2 });
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 200); // 1
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 200); // 2
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 429); // over cap
  });

  it('rejects attaching an operation the connection does not permit (400)', async () => {
    const res = await post(`/agents/${agentId}/connections`, await hostJwt(), { connection_id: connA, allowed_operations: ['nonsense_op'] });
    assert.equal(res.status, 400);
  });

  it('flags a broken wire: a capability whose connection is not authorized', async () => {
    // With only connA attached, the useB grant (-> connB) is a "broken wire".
    await post(`/agents/${agentId}/connections`, await hostJwt(), { connection_id: connA, allowed_operations: [] });
    const body = (await (await fetch(`${base}/agents/${agentId}/grants`)).json()) as { grants: Array<{ capability: string; blocked: boolean }> };
    assert.equal(body.grants.find((g) => g.capability === 'useB')?.blocked, true);
    assert.equal(body.grants.find((g) => g.capability === 'useA')?.blocked, false);
  });

  it('detaching restores unrestricted behavior', async () => {
    const del = await fetch(`${base}/agents/${agentId}/connections/${connA}`, { method: 'DELETE', headers: { authorization: `Bearer ${await hostJwt()}` } });
    assert.equal(del.status, 200);
    // No connector authorizations left -> both work again.
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useA', args: {} })).status, 200);
    assert.equal((await post('/capability/execute', await agentJwt(), { capability: 'useB', args: {} })).status, 200);
  });
});
