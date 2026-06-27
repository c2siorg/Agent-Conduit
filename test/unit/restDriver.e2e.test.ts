import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
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
import { createGatewayApp } from '../../apps/server/src/server/gatewayApp.ts';

const BASE = 'http://conduit.test';
const signer = createJwtSigner();
let jti = 0;
let seq = 0;

function inMemoryStorage() {
  const hosts = new Map<string, any>();
  const agents = new Map<string, any>();
  const connections = new Map<string, any>();
  const grants = new Map<string, any>();
  const audit: any[] = [];
  const seen = new Set<string>();
  const driver: any = {
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
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const rec = { id, ...i, createdAt: new Date() }; connections.set(id, rec); return rec; },
      findById: async (id: string) => connections.get(id) ?? null,
      getEncryptedCredential: async (id: string) => connections.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...connections.values()], hasMore: false, nextCursor: null }),
    },
    capabilityGrants: {
      upsert: async (i: any) => { const rec = { id: `grant-${++seq}`, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(`${i.agentId}:${i.capability}`, rec); return rec; },
      findActive: async (agentId: string, capability: string) => { const g = grants.get(`${agentId}:${capability}`); return g && g.status === 'active' ? g : null; },
      findForAgent: async (agentId: string) => [...grants.values()].filter((g) => g.agentId === agentId),
      setStatus: async () => {},
      revokeAllForAgent: async () => {},
    },
    auditLog: {
      append: async (e: any) => { audit.push({ id: `audit-${++seq}`, createdAt: new Date(), ...e }); },
      query: async () => ({ items: [...audit].reverse(), hasMore: false, nextCursor: null }),
      recordSecurityEvent: async () => {},
    },
    jtiCache: { put: async (j: string) => (seen.has(j) ? false : (seen.add(j), true)) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(driver),
    healthCheck: async () => true,
  };
  return driver;
}

function claims(extra: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: BASE, iat: now, exp: now + 60, jti: `jti-${++jti}`, ...extra };
}

let gateway: Server;
let upstream: Server;
let base = '';
let upstreamUrl = '';
let hostKp: any;
let issuer = '';
const upstreamCalls: Array<{ method?: string; url?: string; auth?: string; body: string }> = [];

before(async () => {
  // A stand-in third-party REST API the driver will actually call over HTTP.
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      upstreamCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: body ? JSON.parse(body) : null, ok: true }));
    });
  });
  upstream.listen(0);
  await new Promise((r) => upstream.once('listening', r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;

  const cipher = createCredentialCipher(randomBytes(32));
  const connectors = createConnectorRegistry(['rest']); // enable the generic HTTP driver
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const identityService = createIdentityService({ storage, stateMachine, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 99999, absoluteLifetimeSeconds: 99999 } });
  const connectionProxy = createConnectionProxy({ storage, cipher, connectors });
  const connectionRegistry = createConnectionRegistryService(storage, cipher);
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage, logger: createLogger('error'), identityService, connectionRegistry, connectionProxy,
    agentPipeline: buildAgentPipeline({ verifier, storage, constraintEngine, config: pc }),
    hostPipeline: buildHostPipeline({ verifier, storage, constraintEngine, config: pc }),
  });
  gateway = app.listen(0);
  await new Promise((r) => gateway.once('listening', r));
  base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
});

after(() => { gateway?.close(); upstream?.close(); });

const hostJwt = () => signer.sign('host+jwt', claims({ iss: issuer }) as never, hostKp.privateKeyJwk);
const post = (path: string, token: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('REST connector executes a real authenticated HTTP call', () => {
  let agentKp: any;
  let agentId = '';

  it('registers an agent, a REST connection, and grants an http operation', async () => {
    agentKp = generateEd25519KeyPair();
    const reg = await post('/agent/register', await hostJwt(), { agent_public_key: agentKp.publicKeyJwk, mode: 'delegated', name: 'rest-caller' });
    agentId = ((await reg.json()) as { agent_id: string }).agent_id;

    // baseUrl + bearer token live in the encrypted credential; the operator supplies them once.
    const conn = await post('/connections', await hostJwt(), {
      name: 'demo-rest', platform: 'rest', auth_method: 'bearer',
      secret: { baseUrl: upstreamUrl, token: 'sekret-bearer-token' },
      allowed_operations: ['POST /widgets'],
    });
    assert.equal(conn.status, 201);
    const connectionId = ((await conn.json()) as { connection_id: string }).connection_id;

    const grant = await post('/agent/grant', await hostJwt(), {
      agent_id: agentId, capability: 'create_widget', connection_id: connectionId, operation: 'POST /widgets', constraints: {},
    });
    assert.equal(grant.status, 201);
  });

  it('executes -> the driver POSTs to the upstream with the injected bearer token', async () => {
    const agentJwt = await signer.sign('agent+jwt', claims({ iss: issuer, sub: agentId }) as never, agentKp.privateKeyJwk);
    const res = await post('/capability/execute', agentJwt, { capability: 'create_widget', args: { name: 'sprocket', qty: 3 } });
    assert.equal(res.status, 200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { data: { received: unknown; ok: boolean } };

    // The upstream actually received the call, authenticated, with the agent's args as the body.
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0]?.method, 'POST');
    assert.equal(upstreamCalls[0]?.url, '/widgets');
    assert.equal(upstreamCalls[0]?.auth, 'Bearer sekret-bearer-token');
    assert.deepEqual(JSON.parse(upstreamCalls[0]?.body ?? '{}'), { name: 'sprocket', qty: 3 });

    // The upstream response flows back, but the credential NEVER reaches the agent.
    assert.deepEqual(body.data.received, { name: 'sprocket', qty: 3 });
    assert.ok(!raw.includes('sekret-bearer-token'), 'credential must never be returned to the agent');
  });
});
