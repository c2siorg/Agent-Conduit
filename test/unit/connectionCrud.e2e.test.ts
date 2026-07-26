import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createConnectorRegistry } from '../../packages/connectors/src/connectorRegistry.ts';
import { ManifestDriver } from '../../packages/connectors/src/manifest/manifestDriver.ts';
import { createConnectionRegistryService } from '../../apps/server/src/connections/connectionRegistry.ts';
import { createCredentialCipher } from '../../apps/server/src/connections/credentialCipher.ts';

let seq = 0;
function inMemoryConnections() {
  const map = new Map<string, any>();
  return {
    connections: {
      create: async (i: any) => { const id = `conn-${++seq}`; const rec = { id, ...i, createdAt: new Date() }; map.set(id, rec); return rec; },
      findById: async (id: string) => map.get(id) ?? null,
      getEncryptedCredential: async (id: string) => map.get(id)?.credentialEncrypted ?? null,
      list: async () => ({ items: [...map.values()], hasMore: false, nextCursor: null }),
      update: async (id: string, patch: any) => { const r = map.get(id); if (!r) return null; Object.assign(r, patch.name !== undefined ? { name: patch.name } : {}, patch.allowedOperations !== undefined ? { allowedOperations: patch.allowedOperations } : {}, patch.credentialEncrypted !== undefined ? { credentialEncrypted: patch.credentialEncrypted } : {}); return r; },
      delete: async (id: string) => { map.delete(id); },
      recordTest: async (id: string, ok: boolean, detail: string, at: Date) => { const r = map.get(id); if (r) { r.lastTestOk = ok; r.lastTestDetail = detail; r.lastTestAt = at; } },
    },
  } as any;
}

// A stand-in platform whose "test" op hits our local server; secret.baseUrl points at it.
let server: Server;
let baseUrl = '';
let shouldPass = true;
before(async () => {
  server = createServer((req, res) => {
    res.writeHead(shouldPass ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: shouldPass }));
  });
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

function testConnectors() {
  const reg = createConnectorRegistry();
  // A probe connector with a live `test` op and a required `token` field.
  reg.register(
    new ManifestDriver({
      platform: 'probe',
      label: 'Probe',
      baseUrl: '{baseUrl}',
      authMethods: ['bearer'],
      headers: { Authorization: 'Bearer {token}' },
      operations: { noop: { description: 'noop', method: 'GET', path: '/' } },
      test: { description: 'whoami', method: 'GET', path: '/me' },
    }),
  );
  return reg;
}

describe('connection update / delete / test', () => {
  const cipher = createCredentialCipher(randomBytes(32));

  it('updates name + allowed operations, and rotates the secret (re-encrypted)', async () => {
    const storage = inMemoryConnections();
    const svc = createConnectionRegistryService(storage, cipher, testConnectors());
    const c = await svc.registerConnection({ name: 'p1', platform: 'probe', secret: { token: 'old', baseUrl }, allowedOperations: ['noop'] });

    const updated = await svc.updateConnection(c.id, { name: 'p1-renamed', allowedOperations: ['noop', 'extra'], secret: { token: 'new', baseUrl } });
    assert.equal(updated.name, 'p1-renamed');
    assert.deepEqual(updated.allowedOperations, ['noop', 'extra']);
    // The rotated secret is decryptable to the new value (and never stored in plaintext).
    const enc = await storage.connections.getEncryptedCredential(c.id);
    assert.equal((JSON.parse(cipher.decrypt(enc)) as any).secret.token, 'new');
  });

  it('tests a connection live: ok when the probe returns 200, fail on 401', async () => {
    const storage = inMemoryConnections();
    const svc = createConnectionRegistryService(storage, cipher, testConnectors());
    const c = await svc.registerConnection({ name: 'p2', platform: 'probe', secret: { token: 't', baseUrl }, allowedOperations: [] });

    shouldPass = true;
    const good = await svc.testConnection(c.id);
    assert.equal(good.ok, true);
    assert.equal(good.checked, 'live');

    shouldPass = false;
    const bad = await svc.testConnection(c.id);
    assert.equal(bad.ok, false);
    assert.equal(bad.checked, 'live');
  });

  it('test reports a structural failure when a required field is missing', async () => {
    const storage = inMemoryConnections();
    const svc = createConnectionRegistryService(storage, cipher, testConnectors());
    const c = await svc.registerConnection({ name: 'p3', platform: 'probe', secret: { token: 't' }, allowedOperations: [] }); // no baseUrl
    const res = await svc.testConnection(c.id);
    assert.equal(res.ok, false);
    assert.equal(res.checked, 'structure');
  });

  it('deletes a connection (and 404s afterwards)', async () => {
    const storage = inMemoryConnections();
    const svc = createConnectionRegistryService(storage, cipher, testConnectors());
    const c = await svc.registerConnection({ name: 'p4', platform: 'probe', secret: { token: 't', baseUrl }, allowedOperations: [] });
    await svc.deleteConnection(c.id);
    assert.equal(await storage.connections.findById(c.id), null);
    await assert.rejects(svc.deleteConnection(c.id), /not found/);
    await assert.rejects(svc.updateConnection(c.id, { name: 'x' }), /not found/);
  });
});
