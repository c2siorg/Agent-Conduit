import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
  const grants = new Map<string, any>(); // key: `${agentId}:${capability}`
  const audit: any[] = [];
  const seen = new Set<string>();
  const driver: any = {
    hosts: {
      create: async (i: any) => {
        const id = `host-${++seq}`;
        const rec = { id, ...i, thumb: i.publicKeyJwk ? jwkThumbprint(i.publicKeyJwk) : null, createdAt: new Date(), updatedAt: new Date() };
        hosts.set(id, rec);
        return rec;
      },
      findById: async (id: string) => hosts.get(id) ?? null,
      findByThumbprint: async (iss: string) => [...hosts.values()].find((h) => h.thumb === iss) ?? null,
      updateStatus: async () => {},
    },
    agents: {
      create: async (i: any) => {
        const id = `agent-${++seq}`;
        const rec = { id, ...i, activatedAt: null, sessionExpiresAt: null, maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date() };
        agents.set(id, rec);
        return rec;
      },
      findById: async (id: string) => agents.get(id) ?? null,
      findBySubject: async (sub: string) => agents.get(sub) ?? null,
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    connections: {
      create: async (i: any) => {
        const id = `conn-${++seq}`;
        const rec = { id, ...i, createdAt: new Date() };
        connections.set(id, rec);
        return rec;
      },
      findById: async (id: string) => connections.get(id) ?? null,
      getEncryptedCredential: async (id: string) => connections.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...connections.values()], hasMore: false, nextCursor: null }),
    },
    capabilityGrants: {
      upsert: async (i: any) => {
        const rec = { id: `grant-${++seq}`, ...i, deniedBy: null, reason: null, createdAt: new Date() };
        grants.set(`${i.agentId}:${i.capability}`, rec);
        return rec;
      },
      findActive: async (agentId: string, capability: string) => {
        const g = grants.get(`${agentId}:${capability}`);
        return g && g.status === 'active' ? g : null;
      },
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

let server: any;
let base = '';
let hostKp: any;
let issuer = '';

before(async () => {
  const storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;

  const cipher = createCredentialCipher(randomBytes(32));
  const connectors = createConnectorRegistry([]); // mock is always available
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const identityService = createIdentityService({ storage, stateMachine, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 99999, absoluteLifetimeSeconds: 99999 } });
  const connectionProxy = createConnectionProxy({ storage, cipher, connectors });
  const connectionRegistry = createConnectionRegistryService(storage, cipher);
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const agentPipeline = buildAgentPipeline({ verifier, storage, constraintEngine, config: pc });
  const hostPipeline = buildHostPipeline({ verifier, storage, constraintEngine, config: pc });

  const app = createGatewayApp({ config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never, storage, logger: createLogger('error'), identityService, connectionRegistry, connectionProxy, agentPipeline, hostPipeline });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

async function hostJwt() {
  return signer.sign('host+jwt', claims({ iss: issuer }) as never, hostKp.privateKeyJwk);
}
async function post(path: string, token: string, body: unknown) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('capability execution end to end (Sprint 2-3 spine)', () => {
  let agentKp: any;
  let agentId = '';
  let connectionId = '';

  it('registers an agent, a connection, and grants a constrained capability', async () => {
    agentKp = generateEd25519KeyPair();
    const reg = await post('/agent/register', await hostJwt(), { agent_public_key: agentKp.publicKeyJwk, mode: 'delegated', name: 'alerter' });
    agentId = ((await reg.json()) as { agent_id: string }).agent_id;

    const conn = await post('/connections', await hostJwt(), { name: 'mock-platform', platform: 'mock', secret: { token: 'xoxb-secret' }, allowed_operations: ['echo'] });
    assert.equal(conn.status, 201);
    connectionId = ((await conn.json()) as { connection_id: string }).connection_id;

    const grant = await post('/agent/grant', await hostJwt(), {
      agent_id: agentId,
      capability: 'send_alert',
      connection_id: connectionId,
      operation: 'echo',
      constraints: { priority: { in: ['low', 'high'] } },
    });
    assert.equal(grant.status, 201);
  });

  async function agentJwt() {
    return signer.sign('agent+jwt', claims({ iss: issuer, sub: agentId }) as never, agentKp.privateKeyJwk);
  }

  it('executes the granted capability within constraints (credential injected, audited)', async () => {
    const res = await post('/capability/execute', await agentJwt(), { capability: 'send_alert', args: { priority: 'high' } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { echo: unknown; credentialInjected: boolean; operation: string } };
    assert.deepEqual(body.data.echo, { priority: 'high' });
    assert.equal(body.data.credentialInjected, true);
    assert.equal(body.data.operation, 'echo');
  });

  it('rejects a constraint violation (403 constraint_violated with violations)', async () => {
    const res = await post('/capability/execute', await agentJwt(), { capability: 'send_alert', args: { priority: 'urgent' } });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string; violations?: unknown[] };
    assert.equal(body.error, 'constraint_violated');
    assert.ok(Array.isArray(body.violations) && body.violations.length >= 1);
  });

  it('rejects an ungranted capability (403 capability_not_granted)', async () => {
    const res = await post('/capability/execute', await agentJwt(), { capability: 'delete_everything', args: {} });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, 'capability_not_granted');
  });

  it('writes an audit entry with an args hash, never raw args', async () => {
    const res = await fetch(`${base}/audit`);
    const body = (await res.json()) as { entries: Array<{ capability: string; outcome: string; args_hash: string | null }> };
    const entry = body.entries.find((e) => e.capability === 'send_alert' && e.outcome === 'success');
    assert.ok(entry, 'expected a successful send_alert audit entry');
    assert.ok(entry?.args_hash && entry.args_hash.length === 64); // sha-256 hex
    assert.ok(!JSON.stringify(body.entries).includes('priority')); // raw args never stored
  });

  it('agent requests a new capability -> pending grant + device-authorization approval (AAP §5.4/§7)', async () => {
    const res = await post('/agent/request-capability', await agentJwt(), {
      capabilities: [{ name: 'read_reports', constraints: { region: { in: ['us', 'eu'] } } }],
      binding_message: 'Allow reading reports',
    });
    assert.equal(res.status, 202); // pending operator approval
    const body = (await res.json()) as {
      agent_capability_grants: Array<{ capability: string; status: string }>;
      approval: { method: string; user_code: string; verification_uri: string; interval: number };
    };
    assert.deepEqual(body.agent_capability_grants, [{ capability: 'read_reports', status: 'pending' }]);
    assert.equal(body.approval.method, 'device_authorization');
    assert.match(body.approval.user_code, /^[A-Z]{4}-[0-9]{4}$/);
    assert.ok(body.approval.verification_uri.endsWith('/approvals'));
  });

  it('/agent/status returns the spec shape with active + pending grants', async () => {
    const res = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${await agentJwt()}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string; host_id: string;
      agent_capability_grants: Array<{ capability: string; status: string }>;
    };
    assert.equal(body.status, 'active');
    assert.ok(body.host_id);
    const byName = Object.fromEntries(body.agent_capability_grants.map((g) => [g.capability, g.status]));
    assert.equal(byName['send_alert'], 'active');
    assert.equal(byName['read_reports'], 'pending');
  });

  it('operator approves the pending request -> capability/list shows it granted', async () => {
    const approve = await post('/agent/grant', await hostJwt(), {
      agent_id: agentId, capability: 'read_reports', connection_id: connectionId, operation: 'echo',
      constraints: { region: { in: ['us', 'eu'] } },
    });
    assert.equal(approve.status, 201);

    const list = await fetch(`${base}/capability/list`, { headers: { authorization: `Bearer ${await agentJwt()}` } });
    const body = (await list.json()) as { capabilities: Array<{ name: string; grant_status: string }> };
    const reports = body.capabilities.find((c) => c.name === 'read_reports');
    assert.equal(reports?.grant_status, 'granted');
  });
});
