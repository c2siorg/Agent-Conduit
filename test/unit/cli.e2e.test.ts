import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { createAdapterRegistry } from '../../packages/adapters/src/adapterRegistry.ts';
import { createConnectorRegistry } from '../../packages/connectors/src/connectorRegistry.ts';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';
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
      updatePublicKey: async (id: string, k: any) => { const a = agents.get(id); if (a) a.publicKeyJwk = k; },
      applyLifetimes: async (id: string, c: any) => { const a = agents.get(id); if (a) Object.assign(a, c); },
    },
    capabilityGrants: {
      upsert: async (i: any) => { const r = { id: `grant-${++seq}`, ...i, deniedBy: null, reason: null, createdAt: new Date() }; grants.set(`${i.agentId}:${i.capability}`, r); return r; },
      findActive: async (a: string, c: string) => { const g = grants.get(`${a}:${c}`); return g && g.status === 'active' ? g : null; },
      findForAgent: async (a: string) => [...grants.values()].filter((g) => g.agentId === a),
    },
    tools: {
      upsert: async (i: any) => { const r = { id: `tool-${++seq}`, name: i.name, adapterType: i.adapterType, adapterConfig: i.adapterConfig, schemaCache: null, schemaCachedAt: null }; toolsMap.set(i.name, r); return r; },
      findByName: async (n: string) => toolsMap.get(n) ?? null,
      list: async () => ({ items: [...toolsMap.values()], hasMore: false, nextCursor: null }),
      cacheSchema: async () => {},
    },
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const r = { id, ...i, createdAt: new Date() }; connMap.set(id, r); return r; },
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

let server: any;
let base = '';
let keyFile = '';

before(async () => {
  const storage = inMemoryStorage();
  const hostKp = generateEd25519KeyPair();
  await storage.hosts.create({ publicKeyJwk: hostKp.publicKeyJwk, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
  keyFile = join(tmpdir(), `conduit-host-${Date.now()}.json`);
  writeFileSync(keyFile, JSON.stringify(hostKp.privateKeyJwk));

  const cipher = createCredentialCipher(randomBytes(32));
  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const cache = createSchemaCache(3600);
  const pc = { issuer: BASE, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };
  const app = createGatewayApp({
    config: { server: { baseUrl: BASE, requestLimits: { jsonBodyBytes: 1048576 } } } as never,
    storage,
    logger: createLogger('error'),
    identityService: createIdentityService({ storage, stateMachine, verifier, issuer: BASE, lifetimes: { sessionTtlSeconds: 3600, maxLifetimeSeconds: 99999, absoluteLifetimeSeconds: 99999 } }),
    connectionRegistry: createConnectionRegistryService(storage, cipher),
    connectionProxy: createConnectionProxy({ storage, cipher, connectors: createConnectorRegistry([]) }),
    tokenRouter: createTokenRouter({ storage, adapters: createAdapterRegistry(), cache, metrics: createMetrics() }),
    schemaCache: cache,
    events: createSecurityEventStream(),
    metrics: createMetrics(),
    agentPipeline: buildAgentPipeline({ verifier, storage, constraintEngine, config: pc }),
    hostPipeline: buildHostPipeline({ verifier, storage, constraintEngine, config: pc }),
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

const run = promisify(execFile);

/** Run the built CLI as a subprocess and parse its JSON stdout. Async so the in-process gateway keeps serving. */
async function cli(...args: string[]): Promise<any> {
  const { stdout } = await run('node', [CLI, ...args, '--url', base], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

describe('admin CLI drives the gateway over HTTP', () => {
  let agentId = '';
  let connectionId = '';

  it('registers and lists an agent', async () => {
    const reg = await cli('agent', 'register', '--host-key', keyFile, '--name', 'cli-agent');
    agentId = reg.agent_id;
    assert.ok(agentId);
    assert.ok(reg.agent_private_key.d); // private key returned to the operator

    const list = await cli('agent', 'list');
    assert.ok(list.agents.some((a: { id: string }) => a.id === agentId));
  });

  it('registers a connection and grants a capability', async () => {
    const conn = await cli('connection', 'register', '--host-key', keyFile, '--name', 'cli-conn', '--platform', 'mock', '--secret', '{"token":"x"}', '--operations', 'echo');
    connectionId = conn.connection_id;
    assert.ok(connectionId);
    assert.ok((await cli('connection', 'list')).connections.some((c: { name: string }) => c.name === 'cli-conn'));

    const grant = await cli('grant', '--host-key', keyFile, '--agent', agentId, '--capability', 'ping', '--connection', connectionId, '--operation', 'echo');
    assert.equal(grant.status, 'active');
  });

  it('registers and lists a tool, and reads metrics + audit', async () => {
    const tool = await cli('tool', 'register', '--host-key', keyFile, '--name', 'cli-tool', '--adapter', 'cli', '--config', '{"command":"cli-tool"}');
    assert.equal(tool.name, 'cli-tool');
    assert.ok((await cli('tool', 'list')).tools.some((t: { name: string }) => t.name === 'cli-tool'));

    assert.ok('tokensByTool' in (await cli('metrics')));
    assert.ok(Array.isArray((await cli('audit')).entries));
  });
});
