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
  const grants = new Map<string, any>(); // key = grantId
  const tasksMap = new Map<string, any>();
  const connMap = new Map<string, any>();
  const audit: any[] = [];
  const seen = new Set<string>();
  const gkey = (agentId: string, cap: string) => `${agentId}::${cap}`;
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
      upsert: async (i: any) => {
        // one active grant per (agent, capability): remove any existing for that key
        for (const [k, g] of grants) if (g.agentId === i.agentId && g.capability === i.capability) grants.delete(k);
        const id = `grant-${++seq}`;
        const rec = { id, ...i, deniedBy: null, reason: null, createdAt: new Date() };
        grants.set(id, rec);
        return rec;
      },
      findActive: async (agentId: string, cap: string) => {
        const now = Date.now();
        return [...grants.values()].find((g) => g.agentId === agentId && g.capability === cap && g.status === 'active' && (!g.expiresAt || g.expiresAt.getTime() > now)) ?? null;
      },
      findForAgent: async (agentId: string) => [...grants.values()].filter((g) => g.agentId === agentId),
      setStatus: async () => {},
      revokeAllForAgent: async () => {},
      revokeByTask: async (taskId: string) => { for (const g of grants.values()) if (g.taskId === taskId) g.status = 'denied'; },
    },
    tasks: {
      create: async (i: any) => { const id = `task-${++seq}`; const r = { id, ...i, status: 'active', createdAt: new Date(), completedAt: null }; tasksMap.set(id, r); return r; },
      findById: async (id: string) => tasksMap.get(id) ?? null,
      list: async () => ({ items: [...tasksMap.values()], hasMore: false, nextCursor: null }),
      setStatus: async (id: string, s: string, at: Date | null) => { const t = tasksMap.get(id); if (t) { t.status = s; t.completedAt = at; } },
    },
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const r = { id, ...i, createdAt: new Date() }; connMap.set(id, r); return r; },
      findById: async (id: string) => connMap.get(id) ?? null,
      getEncryptedCredential: async (id: string) => connMap.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...connMap.values()], hasMore: false, nextCursor: null }),
    },
    auditLog: { append: async (e: any) => { audit.push(e); }, query: async () => ({ items: [...audit].reverse(), hasMore: false, nextCursor: null }), recordSecurityEvent: async () => {} },
    connectionGrants: { listByAgent: async () => [], upsert: async (g) => g, findForAgent: async () => null, delete: async () => {} },
    jtiCache: { put: async (j: string) => (seen.has(j) ? false : (seen.add(j), true)) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(d),
    healthCheck: async () => true,
    _audit: audit,
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
let storage: any;

before(async () => {
  storage = inMemoryStorage();
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

describe('task-scoped ephemeral grants', () => {
  let kp: any;
  let agentId = '';
  let connectionId = '';
  let taskId = '';

  const agentJwt = () => signer.sign('agent+jwt', claims({ iss: issuer, sub: agentId }) as never, kp.privateKeyJwk);

  it('registers an agent + connection', async () => {
    kp = generateEd25519KeyPair();
    agentId = ((await (await post('/agent/register', await hostJwt(), { agent_public_key: kp.publicKeyJwk, mode: 'delegated' })).json()) as { agent_id: string }).agent_id;
    connectionId = ((await (await post('/connections', await hostJwt(), { name: 'mock', platform: 'mock', secret: { token: 'x' }, allowed_operations: ['echo'] })).json()) as { connection_id: string }).connection_id;
  });

  it('has zero standing access before a task (execute -> 403)', async () => {
    const res = await post('/capability/execute', await agentJwt(), { capability: 'send', args: {} });
    assert.equal(res.status, 403);
  });

  it('creates a task that activates a grant, and executes under it (audit carries task_id)', async () => {
    const t = await post('/agent/task', await hostJwt(), {
      agent_id: agentId, name: 'nightly-report', purpose: 'send the report', ttl_seconds: 3600,
      capabilities: [{ capability: 'send', connection_id: connectionId, operation: 'echo', constraints: {} }],
    });
    assert.equal(t.status, 201);
    taskId = ((await t.json()) as { task_id: string }).task_id;

    const exec = await post('/capability/execute', await agentJwt(), { capability: 'send', args: { hi: 1 } });
    assert.equal(exec.status, 200);

    const audit = (await (await fetch(`${base}/audit`)).json()) as { entries: Array<{ capability: string; task_id: string | null; outcome: string }> };
    const entry = audit.entries.find((e) => e.capability === 'send' && e.outcome === 'success');
    assert.equal(entry?.task_id, taskId); // action attributed to the task
  });

  it('lists the task as active', async () => {
    const body = (await (await fetch(`${base}/tasks`)).json()) as { tasks: Array<{ id: string; status: string; name: string }> };
    const t = body.tasks.find((x) => x.id === taskId);
    assert.equal(t?.status, 'active');
    assert.equal(t?.name, 'nightly-report');
  });

  it('exposes the agent grants for the topology view', async () => {
    const body = (await (await fetch(`${base}/agents/${agentId}/grants`)).json()) as { grants: Array<{ capability: string; task_id: string | null; status: string }> };
    const g = body.grants.find((x) => x.capability === 'send');
    assert.equal(g?.status, 'active');
    assert.equal(g?.task_id, taskId);
  });

  it('reports compliance posture with a summary and control domains', async () => {
    const report = (await (await fetch(`${base}/compliance`)).json()) as { summary: { met: number; total: number }; domains: Array<{ domain: string; controls: unknown[] }> };
    assert.ok(report.summary.total > 0);
    assert.ok(report.summary.met > 0);
    assert.ok(report.domains.some((d) => d.domain === 'Authorization & least privilege'));
  });

  it('completing the task revokes its grants (execute -> 403 again, task completed)', async () => {
    const done = await post(`/task/${taskId}/complete`, await hostJwt(), {});
    assert.equal(done.status, 200);
    assert.equal(((await done.json()) as { status: string }).status, 'completed');

    const res = await post('/capability/execute', await agentJwt(), { capability: 'send', args: {} });
    assert.equal(res.status, 403); // zero standing access restored
  });
});
