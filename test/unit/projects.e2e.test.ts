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
  const projects = new Map<string, any>();
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
      setProject: async (id: string, p: string | null) => { const a = agents.get(id); if (a) a.projectId = p; },
      list: async () => ({ items: [...agents.values()], hasMore: false, nextCursor: null }),
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    projects: {
      create: async (i: any) => { const id = `proj-${++seq}`; const r = { id, ...i, createdAt: new Date() }; projects.set(id, r); return r; },
      findById: async (id: string) => projects.get(id) ?? null,
      list: async () => [...projects.values()],
      delete: async (id: string) => { projects.delete(id); },
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

describe('per-project credential isolation', () => {
  let projA = '';
  let projB = '';
  let connA = '';
  let agentAKp: any;
  let agentAId = '';

  it('creates two projects, a project-A connection, and a project-A agent', async () => {
    projA = ((await (await post('/projects', await hostJwt(), { name: 'team-a' })).json()) as any).id;
    projB = ((await (await post('/projects', await hostJwt(), { name: 'team-b' })).json()) as any).id;
    connA = ((await (await post('/connections', await hostJwt(), { name: 'slackA', platform: 'mock', secret: { token: 'x' }, allowed_operations: [], project_id: projA })).json()) as any).connection_id;

    agentAKp = generateEd25519KeyPair();
    agentAId = ((await (await post('/agent/register', await hostJwt(), { agent_public_key: agentAKp.publicKeyJwk, mode: 'delegated', project_id: projA })).json()) as any).agent_id;
    await post('/agent/grant', await hostJwt(), { agent_id: agentAId, capability: 'ping', connection_id: connA, operation: 'echo', constraints: {} });
  });

  const agentAJwt = () => signer.sign('agent+jwt', claims({ iss: issuer, sub: agentAId }) as never, agentAKp.privateKeyJwk);

  it('an agent in the SAME project can use the connection', async () => {
    assert.equal((await post('/capability/execute', await agentAJwt(), { capability: 'ping', args: {} })).status, 200);
  });

  it('rejects a cross-project grant up front (400)', async () => {
    const kp = generateEd25519KeyPair();
    const agentBId = ((await (await post('/agent/register', await hostJwt(), { agent_public_key: kp.publicKeyJwk, mode: 'delegated', project_id: projB })).json()) as any).agent_id;
    // Granting project-A's connection to a project-B agent is blocked at grant time.
    const res = await post('/agent/grant', await hostJwt(), { agent_id: agentBId, capability: 'ping', connection_id: connA, operation: 'echo', constraints: {} });
    assert.equal(res.status, 400);
  });

  it('reassigning an agent out of the project revokes its access at execute time (403)', async () => {
    // Move agent A into project B; the grant it already holds now points at a foreign connection.
    const res = await post('/agent/project', await hostJwt(), { agent_id: agentAId, project_id: projB });
    assert.equal(res.status, 200);
    const exec = await post('/capability/execute', await agentAJwt(), { capability: 'ping', args: {} });
    assert.equal(exec.status, 403); // execute-time isolation is the backstop for grant-time checks
    // Reassign back so the "lists projects" case (and any later reads) see the original layout.
    await post('/agent/project', await hostJwt(), { agent_id: agentAId, project_id: projA });
  });

  it('lists projects', async () => {
    const body = (await (await fetch(`${base}/projects`)).json()) as { projects: Array<{ name: string }> };
    assert.ok(body.projects.some((p) => p.name === 'team-a') && body.projects.some((p) => p.name === 'team-b'));
  });
});
