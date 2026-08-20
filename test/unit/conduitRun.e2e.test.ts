import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
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
const CLI = resolve(process.cwd(), 'packages/cli/dist/index.js');
const run = promisify(execFile);
const signer = createJwtSigner();
let jti = 0;
let seq = 0;

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
      updateStatus: async () => {},
    },
    agents: {
      create: async (i: any) => { const id = `agent-${++seq}`; const r = { id, ...i, activatedAt: null, sessionExpiresAt: null, maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date() }; agents.set(id, r); return r; },
      findById: async (id: string) => agents.get(id) ?? null,
      findBySubject: async (s: string) => agents.get(s) ?? null,
      list: async () => ({ items: [...agents.values()], hasMore: false, nextCursor: null }),
      updateStatus: async (id: string, s: string) => { const a = agents.get(id); if (a) a.status = s; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    projects: { create: async () => ({}), findById: async () => null, list: async () => [], delete: async () => {} },
    capabilityGrants: {
      upsert: async (i: any) => { const id = `grant-${++seq}`; const r = { id, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(id, r); return r; },
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
let keyFile = '';
let hostKp: any;
let issuer = '';
let agentScript = '';

before(async () => {
  const storage = inMemoryStorage();
  const hostRec = await storage.hosts.create({ publicKeyJwk: (hostKp = generateEd25519KeyPair()).publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  issuer = hostRec.thumb;
  const dir = mkdtempSync(join(tmpdir(), 'conduit-run-'));
  keyFile = join(dir, 'host.json');
  writeFileSync(keyFile, JSON.stringify(hostKp.privateKeyJwk));

  // A tiny "agent" that makes a PLAIN, UN-AUTHENTICATED call to CONDUIT_URL — the proxy injects identity.
  agentScript = join(dir, 'agent.mjs');
  writeFileSync(
    agentScript,
    `const res = await fetch(process.env.CONDUIT_URL + '/capability/execute', {
       method: 'POST', headers: { 'content-type': 'application/json', 'x-conduit-token': process.env.CONDUIT_TOKEN },
       body: JSON.stringify({ capability: 'ping', args: { hi: 1 } }) });
     const body = await res.json();
     console.log('AGENT_RESULT ' + res.status + ' ' + JSON.stringify(body.data ?? body));`,
  );

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

  // Operator pre-provisions: a connection + a capability granted to the "conduit-run" agent name is not
  // possible ahead of time (the agent is created by `run`), so we grant AFTER registration below.
});

after(() => server?.close());

const hostJwt = () => signer.sign('host+jwt', claims({ iss: issuer }) as never, hostKp.privateKeyJwk);
const post = (path: string, token: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('conduit run — transparent identity-injecting proxy', () => {
  it('the wrapped agent executes through Conduit with NO token of its own', async () => {
    // Pre-register a connection the granted capability will map to.
    const connectionId = ((await (await post('/connections', await hostJwt(), { name: 'mock', platform: 'mock', secret: { token: 'x' }, allowed_operations: ['echo'] })).json()) as any).connection_id;

    // A wrapper that registers the agent, grants it before starting the child, then runs the agent script.
    // We simulate the operator granting by intercepting: run registers the agent, but we need its id to
    // grant. Instead, grant a capability to ALL future agents is not possible; so we grant here by first
    // registering via run and letting the agent call fail-open? No — we grant by pre-creating the agent.
    //
    // Simpler + faithful: run the CLI; it registers an agent named "conduit-run". Then we look it up and
    // grant, then re-run the agent script against the still-open proxy. To keep it deterministic we instead
    // grant to the agent right after `run` registers it by polling /agents — but the proxy has already
    // started. So: start `conduit run` with a script that waits, grant in parallel, then the script calls.
    const waitScript = agentScript.replace('agent.mjs', 'waiter.mjs');
    writeFileSync(
      waitScript,
      `await new Promise(r => setTimeout(r, 1500));
       // A local caller WITHOUT the per-session proxy token is rejected before any identity is minted.
       const noTok = await fetch(process.env.CONDUIT_URL + '/capability/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: 'ping', args: {} }) });
       console.log('NOTOKEN_RESULT ' + noTok.status);
       const res = await fetch(process.env.CONDUIT_URL + '/capability/execute', { method: 'POST', headers: { 'content-type': 'application/json', 'x-conduit-token': process.env.CONDUIT_TOKEN }, body: JSON.stringify({ capability: 'ping', args: { hi: 1 } }) });
       const body = await res.json();
       console.log('AGENT_RESULT ' + res.status + ' ' + JSON.stringify(body.data ?? body));`,
    );

    const child = run('node', [CLI, 'run', '--host-key', keyFile, '--url', base, '--', 'node', waitScript], { encoding: 'utf8' });

    // While the agent waits (1.5s), poll until `run` has registered its "conduit-run" agent, then grant.
    // Polling (rather than a single fixed sleep) keeps this deterministic under a loaded parallel suite.
    let runAgent: { id: string; name: string } | undefined;
    for (let i = 0; i < 25 && !runAgent; i++) {
      await new Promise((r) => setTimeout(r, 40));
      const agents = (await (await fetch(`${base}/agents`)).json()) as { agents: Array<{ id: string; name: string }> };
      runAgent = agents.agents.find((a) => a.name === 'conduit-run');
    }
    assert.ok(runAgent, 'run should have registered a conduit-run agent');
    await post('/agent/grant', await hostJwt(), { agent_id: runAgent!.id, capability: 'ping', connection_id: connectionId, operation: 'echo', constraints: {} });

    const { stdout } = await child;
    assert.match(stdout, /NOTOKEN_RESULT 401/); // proxy token gates other local processes
    assert.match(stdout, /AGENT_RESULT 200/);
    assert.match(stdout, /"echo":\{"hi":1\}/);
  });
});
