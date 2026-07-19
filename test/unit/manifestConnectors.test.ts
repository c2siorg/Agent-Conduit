import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createConnectorRegistry } from '../../packages/connectors/src/connectorRegistry.ts';
import { ManifestDriver } from '../../packages/connectors/src/manifest/manifestDriver.ts';
import { BUNDLED_MANIFESTS } from '../../packages/connectors/src/manifest/manifests.ts';
import type { ConnectorManifest } from '../../packages/connectors/src/manifest/connectorManifest.ts';

let server: Server;
let baseUrl = '';
const calls: Array<{ method?: string; url?: string; headers: Record<string, unknown>; body: string }> = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

function driver(manifest: Partial<ConnectorManifest>): ManifestDriver {
  return new ManifestDriver({ platform: 'test', label: 'T', baseUrl, authMethods: ['bearer'], operations: {}, ...manifest } as ConnectorManifest);
}
const cred = (secret: Record<string, string>) => ({ authMethod: 'bearer' as const, secret });

describe('ManifestDriver executes declarative connectors', () => {
  it('templates the path, injects a bearer header, and sends leftover args as the body', async () => {
    const d = driver({
      headers: { Authorization: 'Bearer {token}' },
      operations: { create_issue: { description: '', method: 'POST', path: '/repos/{owner}/{repo}/issues' } },
    });
    const res = await d.execute({ operation: 'create_issue', args: { owner: 'me', repo: 'app', title: 'Bug' }, credential: cred({ token: 'sekret' }), options: {} });
    assert.equal(res.status, 'ok');
    const call = calls.at(-1)!;
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/repos/me/app/issues');
    assert.equal(call.headers['authorization'], 'Bearer sekret');
    assert.deepEqual(JSON.parse(call.body), { title: 'Bug' }); // path params removed from body
  });

  it('puts leftover args on the query string for GET', async () => {
    const d = driver({ operations: { list: { description: '', method: 'GET', path: '/items' } } });
    await d.execute({ operation: 'list', args: { page: 2 }, credential: cred({ token: 't' }), options: {} });
    assert.equal(calls.at(-1)!.url, '/items?page=2');
  });

  it('applies static + query-templated auth (api key in query)', async () => {
    const d = driver({ query: { key: '{key}', token: '{token}' }, operations: { boards: { description: '', method: 'GET', path: '/members/me/boards' } } });
    await d.execute({ operation: 'boards', args: {}, credential: cred({ key: 'K', token: 'T' }), options: {} });
    const u = new URL(baseUrl + calls.at(-1)!.url);
    assert.equal(u.searchParams.get('key'), 'K');
    assert.equal(u.searchParams.get('token'), 'T');
  });

  it('posts GraphQL { query, variables } to the base URL', async () => {
    const d = driver({
      style: 'graphql',
      headers: { Authorization: '{token}' },
      operations: { create: { description: '', graphql: 'mutation($input: X!){ create(input:$input){ id } }' } },
    });
    await d.execute({ operation: 'create', args: { input: { title: 'x' } }, credential: cred({ token: 'lin_key' }), options: {} });
    const call = calls.at(-1)!;
    assert.equal(call.headers['authorization'], 'lin_key');
    const parsed = JSON.parse(call.body);
    assert.match(parsed.query, /mutation/);
    assert.deepEqual(parsed.variables, { input: { title: 'x' } });
  });

  it('templates a per-tenant base URL from the secret (e.g. Zendesk subdomain)', async () => {
    // Point the tenant host at our test server via secret.baseUrl override.
    const d = driver({ baseUrl: 'https://{subdomain}.zendesk.com/api/v2', operations: { t: { description: '', method: 'GET', path: '/tickets' } } });
    await d.execute({ operation: 't', args: {}, credential: cred({ token: 'x', baseUrl }), options: {} });
    assert.equal(calls.at(-1)!.url, '/tickets');
  });

  it('validateCredential fails when a required templated field is missing', async () => {
    const d = driver({ baseUrl: 'https://{subdomain}.zendesk.com', headers: { Authorization: 'Bearer {token}' }, operations: {} });
    assert.equal(await d.validateCredential(cred({ token: 't' })), false); // no subdomain
    assert.equal(await d.validateCredential(cred({ token: 't', subdomain: 'acme' })), true);
  });

  it('derives structured credential fields from templates (secret detection + basic split)', () => {
    const d = driver({
      baseUrl: 'https://{subdomain}.zendesk.com/api/v2',
      headers: { Authorization: 'Basic {basic}' },
      operations: {},
    });
    const byKey = Object.fromEntries(d.credentialFields.map((f) => [f.key, f]));
    assert.equal(byKey['subdomain']?.secret, false); // config, not secret
    assert.ok(byKey['username'] && byKey['password']?.secret === true); // basic -> username/password
    assert.equal(byKey['basic'], undefined); // the raw basic blob is not shown as a field
  });

  it('derives a masked token field and marks it secret', () => {
    const d = driver({ headers: { Authorization: 'Bearer {token}' }, operations: {} });
    assert.equal(d.credentialFields.find((f) => f.key === 'token')?.secret, true);
  });

  it('accepts username/password and computes Basic auth for the request', async () => {
    const d = driver({ headers: { Authorization: 'Basic {basic}' }, operations: { t: { description: '', method: 'GET', path: '/me' } } });
    await d.execute({ operation: 't', args: {}, credential: cred({ username: 'a@b.com', password: 'tok', baseUrl }), options: {} });
    const expected = 'Basic ' + Buffer.from('a@b.com:tok').toString('base64');
    assert.equal(calls.at(-1)!.headers['authorization'], expected);
  });

  it('rejects an unknown operation', async () => {
    const d = driver({ operations: {} });
    await assert.rejects(d.execute({ operation: 'nope', args: {}, credential: cred({ token: 't' }), options: {} }), /unsupported/);
  });
});

describe('connector registry bundles all manifests', () => {
  it('resolves a broad sample of the requested platforms', () => {
    const reg = createConnectorRegistry();
    for (const p of ['github', 'notion', 'linear', 'gmail', 'google_calendar', 'zoom', 'discord', 'telegram', 'jira', 'asana', 'monday', 'hubspot', 'salesforce', 'zendesk', 'stripe', 'datadog', 'pagerduty', 'openai', 'claude', 'gemini', 'ollama', 'zapier', 'ifttt', 'linkedin', 'slack', 'rest', 'mock']) {
      assert.ok(reg.get(p), `expected connector "${p}" to be registered`);
    }
  });

  it('list() exposes platform + label for the /connectors endpoint', () => {
    const reg = createConnectorRegistry();
    const gh = reg.list().find((d) => d.platform === 'github');
    assert.equal(gh?.label, 'GitHub');
    assert.ok((gh?.supportedOperations.length ?? 0) > 0);
  });

  it('every bundled manifest builds a driver with operations and a unique platform id', () => {
    const seen = new Set<string>();
    for (const m of BUNDLED_MANIFESTS) {
      assert.ok(!seen.has(m.platform), `duplicate platform ${m.platform}`);
      seen.add(m.platform);
      const d = new ManifestDriver(m);
      assert.ok(d.supportedOperations.length > 0, `${m.platform} has no operations`);
    }
    assert.ok(BUNDLED_MANIFESTS.length >= 40);
  });
});
