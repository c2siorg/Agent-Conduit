import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createConnectorRegistry } from '../../packages/connectors/src/connectorRegistry.ts';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';
import { createJwtVerifier } from '../../packages/crypto/src/jwtVerifier.ts';
import { buildAgentPipeline, buildHostPipeline } from '../../apps/server/src/auth/stages/index.ts';
import { createDashboardAuth } from '../../apps/server/src/auth/dashboard/dashboardAuth.ts';
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
let seq = 0;

function inMemoryStorage() {
  const users = new Map<string, any>();
  const d: any = {
    hosts: { create: async () => ({}), findById: async () => null, findByThumbprint: async () => null, updateStatus: async () => {} },
    agents: { list: async () => ({ items: [], hasMore: false, nextCursor: null }), findById: async () => null, findBySubject: async () => null },
    projects: { list: async () => [] },
    users: {
      create: async (i: any) => { const id = `user-${++seq}`; const r = { id, ...i, createdAt: new Date(), updatedAt: new Date() }; users.set(i.username, r); return r; },
      findByUsername: async (u: string) => users.get(u) ?? null,
      updatePasswordHash: async (id: string, h: string) => { for (const r of users.values()) if (r.id === id) r.passwordHash = h; },
    },
    capabilityGrants: { findForAgent: async () => [] },
    tasks: { list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
    connections: { list: async () => ({ items: [], hasMore: false, nextCursor: null }), findById: async () => null },
    connectionGrants: { listByAgent: async () => [] },
    auditLog: { append: async () => {}, query: async () => ({ items: [], hasMore: false, nextCursor: null }), recordSecurityEvent: async () => {} },
    tools: { list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
    jtiCache: { put: async () => true },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(d),
    healthCheck: async () => true,
  };
  return d;
}

async function buildApp(enabled: boolean) {
  const storage = inMemoryStorage();
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const cipher = createCredentialCipher(randomBytes(32));
  const cache = createSchemaCache(3600);
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const dashboardAuth = createDashboardAuth({
    storage,
    logger: createLogger('error'),
    enabled,
    username: 'admin',
    password: 'hunter2-correct',
    sessionSecret: 'unit-test-secret',
    sessionTtlSeconds: 3600,
    secureCookies: false, // test over http
  });
  await dashboardAuth.seedAdminUser();
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage,
    logger: createLogger('error'),
    identityService: createIdentityService({ storage, stateMachine, verifier, issuer: BASE, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 9999, absoluteLifetimeSeconds: 9999 } }),
    connectionRegistry: createConnectionRegistryService(storage, cipher, createConnectorRegistry([])),
    connectionProxy: createConnectionProxy({ storage, cipher, connectors: createConnectorRegistry([]) }),
    tokenRouter: createTokenRouter({ storage, adapters: { get: () => undefined, register: () => {} } as never, cache, metrics: createMetrics() }),
    schemaCache: cache,
    events: createSecurityEventStream(),
    metrics: createMetrics(),
    dashboardAuth,
    agentPipeline: buildAgentPipeline({ verifier, storage, constraintEngine, config: pc }),
    hostPipeline: buildHostPipeline({ verifier, storage, constraintEngine, config: pc }),
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

describe('dashboard login gate (enabled)', () => {
  let server: any;
  let base = '';
  before(async () => {
    ({ server, base } = await buildApp(true));
  });
  after(() => server?.close());

  it('reports login is required and no one is authenticated', async () => {
    const body = (await (await fetch(`${base}/auth/session`)).json()) as any;
    assert.equal(body.required, true);
    assert.equal(body.authenticated, false);
  });

  it('blocks a browser read (GET /agents) with 401 when unauthenticated', async () => {
    assert.equal((await fetch(`${base}/agents`)).status, 401);
  });

  it('leaves AAP discovery public (never gated)', async () => {
    assert.equal((await fetch(`${base}/.well-known/agent-configuration`)).status, 200);
  });

  it('rejects a wrong password with 401 and sets no cookie', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  });

  it('logs in with the seeded password, sets an httpOnly cookie, and unlocks reads', async () => {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'hunter2-correct' }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie && /conduit_session=/.test(setCookie), 'a session cookie is set');
    assert.match(setCookie!, /HttpOnly/i);
    assert.match(setCookie!, /SameSite=Strict/i);

    const cookie = setCookie!.split(';')[0]!;
    const agents = await fetch(`${base}/agents`, { headers: { cookie } });
    assert.equal(agents.status, 200);

    const sess = (await (await fetch(`${base}/auth/session`, { headers: { cookie } })).json()) as any;
    assert.equal(sess.authenticated, true);
    assert.equal(sess.username, 'admin');
  });
});

describe('dashboard login gate (disabled = open UI)', () => {
  let server: any;
  let base = '';
  before(async () => {
    ({ server, base } = await buildApp(false));
  });
  after(() => server?.close());

  it('reports auth not required', async () => {
    const body = (await (await fetch(`${base}/auth/session`)).json()) as any;
    assert.equal(body.required, false);
  });

  it('leaves reads open (no login)', async () => {
    assert.equal((await fetch(`${base}/agents`)).status, 200);
  });
});
