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
import { ConduitClient } from '../../packages/sdk/src/conduitClient.ts';
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
  const toolsMap = new Map<string, any>();
  const connMap = new Map<string, any>();
  const seen = new Set<string>();
  const d: any = {
    hosts: {
      create: async (i: any) => { const id = `host-${++seq}`; const rec = { id, ...i, thumb: jwkThumbprint(i.publicKeyJwk), createdAt: new Date(), updatedAt: new Date() }; hosts.set(id, rec); return rec; },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async () => {},
    },
    agents: {
      create: async (i: any) => { const id = `agent-${++seq}`; const rec = { id, ...i, activatedAt: null, sessionExpiresAt: null, maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date() }; agents.set(id, rec); return rec; },
      findById: async (id: string) => agents.get(id) ?? null,
      findBySubject: async (sub: string) => agents.get(sub) ?? null,
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    capabilityGrants: {
      upsert: async (i: any) => { const rec = { id: `grant-${++seq}`, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(`${i.agentId}:${i.capability}`, rec); return rec; },
      findActive: async (a: string, c: string) => { const g = grants.get(`${a}:${c}`); return g && g.status === 'active' ? g : null; },
      findForAgent: async (a: string) => [...grants.values()].filter((g) => g.agentId === a),
    },
    tools: {
      upsert: async (i: any) => { const rec = { id: `tool-${++seq}`, name: i.name, adapterType: i.adapterType, adapterConfig: i.adapterConfig, schemaCache: null, schemaCachedAt: null }; toolsMap.set(i.name, rec); return rec; },
      findByName: async (n: string) => toolsMap.get(n) ?? null,
      list: async () => ({ items: [...toolsMap.values()], hasMore: false, nextCursor: null }),
      cacheSchema: async (n: string, schema: any, at: Date) => { const t = toolsMap.get(n); if (t) { t.schemaCache = schema; t.schemaCachedAt = at; } },
    },
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const rec = { id, ...i, createdAt: new Date() }; connMap.set(id, rec); return rec; },
      findById: async (id: string) => connMap.get(id) ?? null,
      getEncryptedCredential: async (id: string) => connMap.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...connMap.values()], hasMore: false, nextCursor: null }),
    },
    auditLog: { append: async () => {}, query: async () => ({ items: [], hasMore: false, nextCursor: null }), recordSecurityEvent: async () => {} },
    jtiCache: { put: async (j: string) => (seen.has(j) ? false : (seen.add(j), true)) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(d),
    healthCheck: async () => true,
  };
  return d;
}

function claims(extra: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: BASE, iat: now, exp: now + 60, jti: `jti-${++jti}`, ...extra };
}

let server: any;
let base = '';
let hostKp: any;
let issuer = '';
let metrics: any;

before(async () => {
  const storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;

  const cipher = createCredentialCipher(randomBytes(32));
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  metrics = createMetrics();
  const schemaCache = createSchemaCache(3600); // one shared per-tool cache (router + /tools routes)
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage,
    logger: createLogger('error'),
    identityService: createIdentityService({ storage, stateMachine, verifier, issuer: BASE, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 99999, absoluteLifetimeSeconds: 99999 } }),
    connectionRegistry: createConnectionRegistryService(storage, cipher),
    connectionProxy: createConnectionProxy({ storage, cipher, connectors: createConnectorRegistry([]) }),
    tokenRouter: createTokenRouter({ storage, adapters: createAdapterRegistry(), cache: schemaCache, metrics }),
    schemaCache,
    events: createSecurityEventStream(),
    metrics,
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

describe('Token Router serves schemas on demand, identity-scoped', () => {
  let kp: any;
  let agentId = '';

  it('registers agent + tool and grants the capability', async () => {
    kp = generateEd25519KeyPair();
    agentId = ((await (await post('/agent/register', await hostJwt(), { agent_public_key: kp.publicKeyJwk, mode: 'delegated' })).json()) as { agent_id: string }).agent_id;
    const tool = await post('/tools', await hostJwt(), { name: 'reports', adapter_type: 'cli', adapter_config: { command: 'reports', description: 'Run reports', options: [{ name: 'range', required: true }] } });
    assert.equal(tool.status, 201);
    await post('/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'reports', constraints: {} });
  });

  const agentJwt = () => signer.sign('agent+jwt', claims({ iss: issuer, sub: agentId }) as never, kp.privateKeyJwk);

  it('serves the normalized schema to a granted agent (with a token estimate)', async () => {
    const res = await fetch(`${base}/tools/reports`, { headers: { authorization: `Bearer ${await agentJwt()}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { name: string; input: any; token_estimate: number; cached: boolean };
    assert.equal(body.name, 'reports');
    assert.deepEqual(body.input.required, ['range']);
    assert.ok(body.token_estimate > 0);
    assert.equal(body.cached, false);

    const again = await fetch(`${base}/tools/reports`, { headers: { authorization: `Bearer ${await agentJwt()}` } });
    assert.equal(((await again.json()) as { cached: boolean }).cached, true); // per-tool cache hit
  });

  it('returns 403 and NO schema for an ungranted tool', async () => {
    const res = await fetch(`${base}/tools/secret`, { headers: { authorization: `Bearer ${await agentJwt()}` } });
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['error'], 'capability_not_granted');
    assert.equal(body['input'], undefined); // the agent never sees a schema
  });

  it('lists tools (names only) and reports token metrics', async () => {
    const list = (await (await fetch(`${base}/tools`)).json()) as { tools: Array<{ name: string }> };
    assert.ok(list.tools.some((t) => t.name === 'reports'));
    const snap = (await (await fetch(`${base}/metrics`)).json()) as { tokensByTool: Record<string, { calls: number }> };
    assert.ok((snap.tokensByTool['reports']?.calls ?? 0) >= 1);
  });
});

describe('conduit-client SDK drives register -> grant -> fetch schema -> execute', () => {
  it('runs the full identity-scoped flow through the SDK', async () => {
    const client = new ConduitClient({ baseUrl: base, hostPrivateKeyJwk: hostKp.privateKeyJwk });
    const { agentId, status } = await client.connectAgent();
    assert.equal(status, 'active');

    // Operator side: register a connection + tool, then grant the capability that maps them.
    const conn = await post('/connections', await hostJwt(), { name: 'mock', platform: 'mock', secret: { token: 'x' }, allowed_operations: ['echo'] });
    const connectionId = ((await conn.json()) as { connection_id: string }).connection_id;
    await post('/tools', await hostJwt(), { name: 'echo_tool', adapter_type: 'cli', adapter_config: { command: 'echo_tool', options: [{ name: 'msg', required: true }] } });
    await post('/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'echo_tool', connection_id: connectionId, operation: 'echo', constraints: {} });

    // Agent side, all via the SDK (fresh JWT per call).
    const result = (await client.executeCapability(agentId, 'echo_tool', { msg: 'hi' })) as { echo: unknown };
    assert.deepEqual(result.echo, { msg: 'hi' });

    const schema = await client.getToolSchema(agentId, 'echo_tool');
    assert.equal(schema.name, 'echo_tool');
    assert.ok(schema.token_estimate > 0);

    const st = await client.agentStatus(agentId);
    assert.equal(st.status, 'active');
    assert.ok(st.agent_capability_grants.some((g) => g.capability === 'echo_tool'));

    const caps = await client.listCapabilities(agentId);
    assert.ok(caps.some((c) => c.name === 'echo_tool' && c.grant_status === 'granted'));

    await assert.rejects(client.getToolSchema(agentId, 'not_granted'));
  });
});
