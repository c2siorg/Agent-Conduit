import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';
import { createJwtSigner } from '../../packages/crypto/src/jwtSigner.ts';
import { createJwtVerifier } from '../../packages/crypto/src/jwtVerifier.ts';
import { buildAgentPipeline, buildHostPipeline } from '../../apps/server/src/auth/stages/index.ts';
import { createConstraintEngine } from '../../apps/server/src/identity/constraintEngine.ts';
import { createIdentityService } from '../../apps/server/src/identity/identityService.ts';
import { createStateMachine } from '../../apps/server/src/identity/stateMachine.ts';
import { createLogger } from '../../apps/server/src/observability/logger.ts';
import { createGatewayApp } from '../../apps/server/src/server/gatewayApp.ts';

const BASE = 'http://conduit.test';
const signer = createJwtSigner();
let jti = 0;
let hostSeq = 0;
let agentSeq = 0;

/** Minimal in-memory StorageDriver covering the host/agent/jti surface Sprint 1 touches. */
function inMemoryStorage() {
  const hosts = new Map<string, any>();
  const agents = new Map<string, any>();
  const seenJti = new Set<string>();
  const driver: any = {
    hosts: {
      create: async (i: any) => {
        const id = `host-${++hostSeq}`;
        const rec = { id, ...i, thumb: i.publicKeyJwk ? jwkThumbprint(i.publicKeyJwk) : null, createdAt: new Date(), updatedAt: new Date() };
        hosts.set(id, rec);
        return rec;
      },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async (id: string, s: string) => { const h = hosts.get(id); if (h) h.status = s; },
    },
    agents: {
      create: async (i: any) => {
        const id = `agent-${++agentSeq}`;
        const rec = { id, ...i, activatedAt: null, sessionExpiresAt: null, maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date() };
        agents.set(id, rec);
        return rec;
      },
      findById: async (id: string) => agents.get(id) ?? null,
      findBySubject: async (sub: string) => agents.get(sub) ?? null,
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      updateMetadata: async (id: string, name: string | null, description: string | null) => {
        const a = agents.get(id);
        if (a) {
          a.name = name;
          a.description = description;
        }
      },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
      list: async () => ({ items: [...agents.values()], hasMore: false, nextCursor: null }),
    },
    capabilityGrants: { findForAgent: async () => [] },
    jtiCache: { put: async (j: string) => (seenJti.has(j) ? false : (seenJti.add(j), true)) },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(driver),
    healthCheck: async () => true,
  };
  return driver;
}

function tokenClaims(extra: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: BASE, iat: now, exp: now + 60, jti: `jti-${++jti}`, ...extra };
}

let server: any;
let base = '';
let hostKp: any;
let issuer = '';
let storage: any;

before(async () => {
  storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;

  const config = createConfig();
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const identityService = createIdentityService({ storage, stateMachine, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 99999, absoluteLifetimeSeconds: 99999 } });
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const agentPipeline = buildAgentPipeline({ verifier, storage, constraintEngine, config: pc });
  const hostPipeline = buildHostPipeline({ verifier, storage, constraintEngine, config: pc });

  const app = createGatewayApp({ config, storage, logger: createLogger('error'), identityService, agentPipeline, hostPipeline });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

function createConfig() {
  return { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never;
}

describe('agent registration + status (end to end over HTTP)', () => {
  let agentKp: any;
  let agentId = '';

  it('registers an agent with a host JWT', async () => {
    agentKp = generateEd25519KeyPair();
    const hostJwt = await signer.sign('host+jwt', tokenClaims({ iss: issuer }) as never, hostKp.privateKeyJwk);
    const res = await fetch(`${base}/agent/register`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_public_key: agentKp.publicKeyJwk,
        mode: 'delegated',
        name: 'report-bot',
        description: 'Posts daily reports',
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { agent_id: string; status: string };
    assert.equal(body.status, 'active');
    agentId = body.agent_id;
  });

  it('authenticates the agent at /agent/status', async () => {
    const agentJwt = await signer.sign('agent+jwt', tokenClaims({ iss: issuer, sub: agentId }) as never, agentKp.privateKeyJwk);
    const res = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${agentJwt}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { agent_id: string; status: string };
    assert.equal(body.agent_id, agentId);
    assert.equal(body.status, 'active');
  });

  it('lists the agent in the admin registry with its name/description', async () => {
    const res = await fetch(`${base}/agents`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      agents: Array<{ id: string; name: string | null; description: string | null }>;
    };
    const found = body.agents.find((a) => a.id === agentId);
    assert.ok(found);
    assert.equal(found?.name, 'report-bot');
    assert.equal(found?.description, 'Posts daily reports');
  });

  it('updates the agent name/description with a host JWT', async () => {
    const hostJwt = await signer.sign('host+jwt', tokenClaims({ iss: issuer }) as never, hostKp.privateKeyJwk);
    const res = await fetch(`${base}/agent/update`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, name: 'renamed-bot', description: 'Updated note' }),
    });
    assert.equal(res.status, 200);
    const list = (await (await fetch(`${base}/agents`)).json()) as {
      agents: Array<{ id: string; name: string | null; description: string | null }>;
    };
    const found = list.agents.find((a) => a.id === agentId);
    assert.equal(found?.name, 'renamed-bot');
    assert.equal(found?.description, 'Updated note');
  });

  it('rejects /agent/status without a token (401 authentication_required)', async () => {
    const res = await fetch(`${base}/agent/status`);
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'authentication_required');
  });

  it('rejects a host JWT at the agent endpoint (token confusion)', async () => {
    const hostJwt = await signer.sign('host+jwt', tokenClaims({ iss: issuer }) as never, hostKp.privateKeyJwk);
    const res = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${hostJwt}` } });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_jwt');
  });

  it('revokes the agent with a host JWT', async () => {
    const hostJwt = await signer.sign('host+jwt', tokenClaims({ iss: issuer }) as never, hostKp.privateKeyJwk);
    const res = await fetch(`${base}/agent/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    });
    assert.equal(res.status, 200);
  });

  it('then rejects the revoked agent at /agent/status (agent_revoked)', async () => {
    const agentJwt = await signer.sign(
      'agent+jwt',
      tokenClaims({ iss: issuer, sub: agentId }) as never,
      agentKp.privateKeyJwk,
    );
    const res = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${agentJwt}` } });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, 'agent_revoked');
  });

  it('rejects revoke from a host that does not own the agent', async () => {
    const host2 = generateEd25519KeyPair();
    await storage.hosts.create({
      publicKeyJwk: host2.publicKeyJwk,
      jwksUrl: null,
      userId: null,
      defaultCapabilities: [],
      status: 'active',
    });
    const hostJwt = await signer.sign(
      'host+jwt',
      tokenClaims({ iss: jwkThumbprint(host2.publicKeyJwk) }) as never,
      host2.privateKeyJwk,
    );
    const res = await fetch(`${base}/agent/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    });
    assert.equal(res.status, 403);
  });
});
