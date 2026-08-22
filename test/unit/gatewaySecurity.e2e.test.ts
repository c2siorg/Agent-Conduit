/**
 * Adversarial security tests for the gateway — probes the 5-stage JWT pipeline and credential handling for
 * real bypasses: token/type confusion, signature forgery via `sub` spoofing, alg:none / alg confusion,
 * jti replay, aud binding, expiry, immediate revocation, capability + constraint bypass (incl. field
 * omission), and platform-credential non-exposure (never returned to the agent; audit stores an args hash).
 */
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
const auditLog: any[] = []; // captured audit entries for assertions

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
      updateStatus: async (id: string, s: string) => { const h = hosts.get(id); if (h) h.status = s; },
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
    auditLog: { append: async (e: any) => { auditLog.push(e); }, query: async () => ({ items: [], hasMore: false, nextCursor: null }), recordSecurityEvent: async () => {} },
    jtiCache: { put: async (j: string) => (seen.has(j) ? false : (seen.add(j), true)) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(d),
    healthCheck: async () => true,
  };
  return d;
}

const now = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown>) => ({ aud: BASE, iat: now(), exp: now() + 60, jti: `jti-${++jti}`, ...extra });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Hand-craft a raw compact JWT (bypasses the signer) for alg-tampering probes. */
const rawToken = (header: unknown, payload: unknown, sig = '') => `${b64(header)}.${b64(payload)}.${sig}`;

let server: any;
let base = '';
let hostKp: any;
let issuer = '';
const SECRET = 'sk-supersecret-token-value';

// Provisioned in `before`:
let agentId = '';
let agentKp: any;

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
const agentJwtWith = (kp: any, sub: string, extra: Record<string, unknown> = {}) =>
  signer.sign('agent+jwt', claims({ iss: issuer, sub, ...extra }) as never, kp.privateKeyJwk);
const call = (method: string, path: string, token: string | null, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const exec = (token: string, capability: string, args: Record<string, unknown>) => call('POST', '/capability/execute', token, { capability, args });

describe('gateway security — provisioning', () => {
  it('registers a connection (with a secret) + an agent + a constrained grant', async () => {
    const conn = ((await (await call('POST', '/connections', await hostJwt(), { name: 'mock', platform: 'mock', secret: { token: SECRET }, allowed_operations: ['echo'] })).json()) as any).connection_id;
    agentKp = generateEd25519KeyPair();
    agentId = ((await (await call('POST', '/agent/register', await hostJwt(), { agent_public_key: agentKp.publicKeyJwk, mode: 'delegated', name: 'victim' })).json()) as any).agent_id;
    // Grant "safe" pinned to owner=acme; "audited" open (for the credential/audit test).
    await call('POST', '/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'safe', connection_id: conn, operation: 'echo', constraints: { owner: 'acme' } });
    await call('POST', '/agent/grant', await hostJwt(), { agent_id: agentId, capability: 'audited', connection_id: conn, operation: 'echo', constraints: {} });
    assert.equal((await exec(await agentJwtWith(agentKp, agentId), 'safe', { owner: 'acme' })).status, 200);
  });
});

describe('gateway security — token/type confusion', () => {
  it('rejects a host+jwt on an agent-only endpoint (execute)', async () => {
    assert.equal((await exec(await hostJwt(), 'safe', { owner: 'acme' })).status, 401);
  });
  it('rejects an agent+jwt on a host-only endpoint (grant)', async () => {
    const jwt = await agentJwtWith(agentKp, agentId);
    assert.equal((await call('POST', '/agent/grant', jwt, { agent_id: agentId, capability: 'x', connection_id: 'y', operation: 'z', constraints: {} })).status, 401);
  });
  it('rejects a missing bearer token', async () => {
    assert.equal((await exec('', 'safe', { owner: 'acme' })).status, 401);
  });
});

describe('gateway security — signature forgery', () => {
  it('rejects `sub` spoofing: attacker signs the victim agent id with their OWN key', async () => {
    const attacker = generateEd25519KeyPair(); // never registered as the victim
    const forged = await agentJwtWith(attacker, agentId); // sub = victim, wrong signer
    assert.equal((await exec(forged, 'safe', { owner: 'acme' })).status, 401);
  });
  it('rejects alg:none (unsigned) tokens', async () => {
    const tok = rawToken({ alg: 'none', typ: 'agent+jwt' }, claims({ iss: issuer, sub: agentId }), '');
    assert.equal((await exec(tok, 'safe', { owner: 'acme' })).status, 401);
  });
  it('rejects alg confusion (HS256 header with a bogus signature)', async () => {
    const tok = rawToken({ alg: 'HS256', typ: 'agent+jwt' }, claims({ iss: issuer, sub: agentId }), Buffer.from('forged').toString('base64url'));
    assert.equal((await exec(tok, 'safe', { owner: 'acme' })).status, 401);
  });
  it('rejects a tampered payload (signature no longer matches)', async () => {
    const good = await agentJwtWith(agentKp, agentId);
    const [h, , s] = good.split('.');
    const tampered = `${h}.${b64(claims({ iss: issuer, sub: agentId, capabilities: ['*'] }))}.${s}`;
    assert.equal((await exec(tampered, 'safe', { owner: 'acme' })).status, 401);
  });
});

describe('gateway security — claim binding', () => {
  it('rejects a wrong audience', async () => {
    const tok = await signer.sign('agent+jwt', { ...claims({ iss: issuer, sub: agentId }), aud: 'https://evil.example' } as never, agentKp.privateKeyJwk);
    assert.equal((await exec(tok, 'safe', { owner: 'acme' })).status, 401);
  });
  it('rejects an expired token', async () => {
    const past = { iss: issuer, sub: agentId, aud: BASE, iat: now() - 600, exp: now() - 300, jti: `jti-${++jti}` };
    const tok = await signer.sign('agent+jwt', past as never, agentKp.privateKeyJwk);
    assert.equal((await exec(tok, 'safe', { owner: 'acme' })).status, 401);
  });
  it('rejects jti replay (same token used twice)', async () => {
    const tok = await agentJwtWith(agentKp, agentId);
    assert.equal((await exec(tok, 'safe', { owner: 'acme' })).status, 200);
    assert.equal((await exec(tok, 'safe', { owner: 'acme' })).status, 401); // replay
  });
});

describe('gateway security — capability + constraint enforcement', () => {
  it('denies a capability the agent was never granted (403, never reaches the platform)', async () => {
    assert.equal((await exec(await agentJwtWith(agentKp, agentId), 'not_granted', {})).status, 403);
  });
  it('enforces an exact constraint: wrong value is denied', async () => {
    assert.equal((await exec(await agentJwtWith(agentKp, agentId), 'safe', { owner: 'evilcorp' })).status, 403);
  });
  it('is fail-closed: OMITTING a constrained field is denied (no bypass)', async () => {
    assert.equal((await exec(await agentJwtWith(agentKp, agentId), 'safe', {})).status, 403);
  });
  it('honors a narrowing `capabilities` JWT claim (token can restrict below its grants)', async () => {
    const restricted = await agentJwtWith(agentKp, agentId, { capabilities: ['other'] });
    assert.equal((await exec(restricted, 'safe', { owner: 'acme' })).status, 403);
  });
});

describe('gateway security — immediate revocation', () => {
  it('denies instantly after the agent is revoked (state never cached past revocation)', async () => {
    assert.equal((await exec(await agentJwtWith(agentKp, agentId), 'safe', { owner: 'acme' })).status, 200);
    await call('POST', '/agent/revoke', await hostJwt(), { agent_id: agentId });
    assert.equal((await exec(await agentJwtWith(agentKp, agentId), 'safe', { owner: 'acme' })).status, 403);
  });
});

describe('gateway security — credential non-exposure', () => {
  let freshAgentId = '';
  let freshKp: any;
  before(async () => {
    const conn = ((await (await call('POST', '/connections', await hostJwt(), { name: 'mock2', platform: 'mock', secret: { token: SECRET }, allowed_operations: ['echo'] })).json()) as any).connection_id;
    freshKp = generateEd25519KeyPair();
    freshAgentId = ((await (await call('POST', '/agent/register', await hostJwt(), { agent_public_key: freshKp.publicKeyJwk, mode: 'delegated', name: 'creduser' })).json()) as any).agent_id;
    await call('POST', '/agent/grant', await hostJwt(), { agent_id: freshAgentId, capability: 'cred', connection_id: conn, operation: 'echo', constraints: {} });
  });

  it('never returns the platform secret to the agent', async () => {
    const res = await exec(await agentJwtWith(freshKp, freshAgentId), 'cred', { hello: 'world' });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(SECRET), 'response must not contain the platform credential');
  });

  it('audits denials with an args HASH, never the raw arg values', async () => {
    auditLog.length = 0;
    // A constraint denial on the "safe" cap (revoked agent is gone; use a fresh grant with a constraint).
    const conn = ((await (await call('POST', '/connections', await hostJwt(), { name: 'mock3', platform: 'mock', secret: { token: SECRET }, allowed_operations: ['echo'] })).json()) as any).connection_id;
    const kp = generateEd25519KeyPair();
    const aid = ((await (await call('POST', '/agent/register', await hostJwt(), { agent_public_key: kp.publicKeyJwk, mode: 'delegated' })).json()) as any).agent_id;
    await call('POST', '/agent/grant', await hostJwt(), { agent_id: aid, capability: 'pin', connection_id: conn, operation: 'echo', constraints: { owner: 'acme' } });
    const secretArg = 'topsecret-argument-value';
    await exec(await agentJwtWith(kp, aid), 'pin', { owner: 'evil', note: secretArg }); // denied
    const denial = auditLog.find((e) => e.outcome === 'denied');
    assert.ok(denial, 'a denial audit entry was written');
    assert.ok(denial.argsHash, 'denial carries an args hash');
    assert.ok(!JSON.stringify(denial).includes(secretArg), 'raw arg values are never in the audit entry');
  });
});
