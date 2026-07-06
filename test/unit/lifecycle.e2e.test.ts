import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
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
  const grants = new Map<string, any>();
  const seen = new Set<string>();
  const driver: any = {
    hosts: {
      create: async (i: any) => { const id = `host-${++seq}`; const rec = { id, ...i, thumb: jwkThumbprint(i.publicKeyJwk), createdAt: new Date(), updatedAt: new Date() }; hosts.set(id, rec); return rec; },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async (id: string, s: string) => { const h = hosts.get(id); if (h) h.status = s; },
      updatePublicKey: async (id: string, jwk: any) => { const h = hosts.get(id); if (h) { h.publicKeyJwk = jwk; h.thumb = jwkThumbprint(jwk); } },
    },
    agents: {
      create: async (i: any) => { const id = `agent-${++seq}`; const rec = { id, ...i, activatedAt: null, sessionExpiresAt: null, maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date() }; agents.set(id, rec); return rec; },
      findById: async (id: string) => agents.get(id) ?? null,
      findBySubject: async (sub: string) => agents.get(sub) ?? null,
      listByHost: async (hostId: string) => [...agents.values()].filter((a) => a.hostId === hostId),
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      updatePublicKey: async (id: string, jwk: any) => { const a = agents.get(id); if (a) a.publicKeyJwk = jwk; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    capabilityGrants: {
      upsert: async (i: any) => { const rec = { id: `grant-${++seq}`, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(`${i.agentId}:${i.capability}`, rec); return rec; },
      findActive: async (agentId: string, capability: string) => { const g = grants.get(`${agentId}:${capability}`); return g && g.status === 'active' ? g : null; },
      findForAgent: async (agentId: string) => [...grants.values()].filter((g) => g.agentId === agentId),
    },
    auditLog: { append: async () => {}, query: async () => ({ items: [], hasMore: false, nextCursor: null }), recordSecurityEvent: async () => {} },
    jtiCache: { put: async (j: string) => (seen.has(j) ? false : (seen.add(j), true)) },
    connections: { findById: async () => null, getEncryptedCredential: async () => null, list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(driver),
    healthCheck: async () => true,
  };
  return driver;
}

function claims(extra: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: BASE, iat: now, exp: now + 60, jti: `jti-${++jti}`, ...extra };
}

let server: any;
let base = '';
let storage: any;
let hostKp: any;
let issuer = '';

before(async () => {
  storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;

  const cipher = createCredentialCipher(randomBytes(32));
  const connectors = createConnectorRegistry([]);
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const identityService = createIdentityService({
    storage, stateMachine, verifier, issuer: BASE,
    lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 99999, absoluteLifetimeSeconds: 99999 },
  });
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage, logger: createLogger('error'), identityService,
    connectionRegistry: createConnectionRegistryService(storage, cipher),
    connectionProxy: createConnectionProxy({ storage, cipher, connectors }),
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
const agentJwt = (kp: any, id: string, extra: Record<string, unknown> = {}) =>
  signer.sign('agent+jwt', claims({ iss: issuer, sub: id, ...extra }) as never, kp.privateKeyJwk);

describe('agent + host lifecycle endpoints', () => {
  let kp1: any;
  let kp2: any;
  let agentId = '';

  it('registers an agent and grants a capability', async () => {
    kp1 = generateEd25519KeyPair();
    const reg = await post('/agent/register', await hostJwt(), { agent_public_key: kp1.publicKeyJwk, mode: 'delegated', name: 'lc' });
    agentId = ((await reg.json()) as { agent_id: string }).agent_id;
    const grant = await post('/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'ping', connection_id: 'conn-x', operation: 'echo', constraints: {} });
    assert.equal(grant.status, 201);
  });

  it('describe returns granted vs not_granted (AAP §5.2.1)', async () => {
    const g = await fetch(`${base}/capability/describe?name=ping`, { headers: { authorization: `Bearer ${await agentJwt(kp1, agentId)}` } });
    assert.equal(((await g.json()) as { grant_status: string }).grant_status, 'granted');
    const n = await fetch(`${base}/capability/describe?name=nope`, { headers: { authorization: `Bearer ${await agentJwt(kp1, agentId)}` } });
    assert.equal(((await n.json()) as { grant_status: string }).grant_status, 'not_granted');
  });

  it('introspect reports an active token and rejects invalid ones (AAP §5.12)', async () => {
    const res = await post('/agent/introspect', await hostJwt(), { token: await agentJwt(kp1, agentId) });
    const body = (await res.json()) as { active: boolean; sub: string; capabilities: string[] };
    assert.equal(body.active, true);
    assert.equal(body.sub, agentId);
    assert.deepEqual(body.capabilities, ['ping']);

    const bad = await post('/agent/introspect', await hostJwt(), { token: 'not.a.jwt' });
    assert.equal(((await bad.json()) as { active: boolean }).active, false);

    const wrongAud = await post('/agent/introspect', await hostJwt(), { token: await agentJwt(kp1, agentId, { aud: 'http://evil' }) });
    assert.equal(((await wrongAud.json()) as { active: boolean }).active, false);
  });

  it('rotate-key swaps the agent key: old key stops verifying, new key works (AAP §5.9)', async () => {
    kp2 = generateEd25519KeyPair();
    const rot = await post('/agent/rotate-key', await hostJwt(), { agent_id: agentId, agent_public_key: kp2.publicKeyJwk });
    assert.equal(rot.status, 200);

    const withNew = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${await agentJwt(kp2, agentId)}` } });
    assert.equal(withNew.status, 200);
    const withOld = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${await agentJwt(kp1, agentId)}` } });
    assert.equal(withOld.status, 401); // old key no longer matches the stored public key
  });

  it('reactivate revives an expired agent, keeping the absolute clock (AAP §2.5)', async () => {
    await storage.agents.updateStatus(agentId, 'expired');
    const res = await post('/agent/reactivate', await hostJwt(), { agent_id: agentId });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; session_expires_at: string | null };
    assert.equal(body.status, 'active');
    assert.ok(body.session_expires_at);
  });

  it('host/revoke cascades: the host and its agents become revoked (AAP §2.11)', async () => {
    const res = await post('/host/revoke', await hostJwt(), {});
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { status: string }).status, 'revoked');
    // Cascaded: the agent is now revoked and cannot authenticate.
    const s = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${await agentJwt(kp2, agentId)}` } });
    assert.equal(s.status, 403);
  });
});
