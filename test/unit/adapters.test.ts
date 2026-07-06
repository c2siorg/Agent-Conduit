import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAdapterRegistry } from '../../packages/adapters/src/adapterRegistry.ts';
import { CliAdapter } from '../../packages/adapters/src/cli/cliAdapter.ts';
import { McpAdapter } from '../../packages/adapters/src/mcp/mcpAdapter.ts';
import { OpenApiAdapter } from '../../packages/adapters/src/openapi/openApiAdapter.ts';
import { createSchemaCache } from '../../apps/server/src/router/schemaCache.ts';
import { createSecurityEventStream } from '../../apps/server/src/observability/securityEventStream.ts';
import { createMetrics } from '../../apps/server/src/observability/metrics.ts';

async function normalize(adapter: { fetchSchema: (c: Record<string, unknown>) => Promise<unknown>; normalize: (r: unknown) => unknown }, config: Record<string, unknown>) {
  return adapter.normalize(await adapter.fetchSchema(config));
}

describe('tool adapters normalize to the canonical schema', () => {
  it('MCP maps inputSchema directly', async () => {
    const out = (await normalize(new McpAdapter(), {
      tool: { name: 'search', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
    })) as any;
    assert.equal(out.name, 'search');
    assert.deepEqual(out.input.required, ['q']);
  });

  it('OpenAPI merges parameters + JSON request body', async () => {
    const out = (await normalize(new OpenApiAdapter(), {
      name: 'create_issue',
      operation: {
        summary: 'Create an issue',
        parameters: [{ name: 'repo', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } } },
      },
    })) as any;
    assert.equal(out.name, 'create_issue');
    assert.ok(out.input.properties.repo && out.input.properties.title);
    assert.deepEqual(new Set(out.input.required), new Set(['repo', 'title']));
  });

  it('CLI maps options to properties', async () => {
    const out = (await normalize(new CliAdapter(), {
      command: 'deploy', description: 'Deploy', options: [{ name: 'env', required: true }, { name: 'force', type: 'boolean' }],
    })) as any;
    assert.equal(out.name, 'deploy');
    assert.deepEqual(out.input.required, ['env']);
    assert.equal(out.input.properties.force.type, 'boolean');
  });

  it('registry resolves the bundled adapters', () => {
    const reg = createAdapterRegistry();
    assert.equal(reg.get('mcp')?.type, 'mcp');
    assert.equal(reg.get('openapi')?.type, 'openapi');
    assert.equal(reg.get('cli')?.type, 'cli');
  });
});

describe('schema cache is per-tool with TTL', () => {
  it('hits, misses on expiry, and flushes', () => {
    const cache = createSchemaCache(3600);
    const schema = { name: 't', description: '', input: { type: 'object' } };
    cache.set('t', schema);
    assert.deepEqual(cache.get('t'), schema);
    cache.invalidate('t');
    assert.equal(cache.get('t'), undefined);

    const noCache = createSchemaCache(0); // disabled
    noCache.set('t', schema);
    assert.equal(noCache.get('t'), undefined);
  });
});

describe('security event stream + metrics', () => {
  it('publishes to subscribers and stamps id/createdAt', () => {
    const stream = createSecurityEventStream();
    const seen: unknown[] = [];
    const unsub = stream.subscribe((e) => seen.push(e));
    stream.publish({ type: 'constraintViolated', agentId: null, hostId: null, detail: { x: 1 } });
    assert.equal(seen.length, 1);
    assert.ok((seen[0] as { id: string }).id);
    unsub();
    stream.publish({ type: 'signatureInvalid', agentId: null, hostId: null, detail: {} });
    assert.equal(seen.length, 1); // no longer subscribed
  });

  it('aggregates token + latency metrics', () => {
    const m = createMetrics();
    m.recordTokenEstimate('t', 100);
    m.recordTokenEstimate('t', 50);
    m.recordLatency('/tools', 20);
    m.incrementCounter('tool.served');
    const snap = m.snapshot();
    assert.equal(snap.tokensByTool['t']?.totalTokens, 150);
    assert.equal(snap.latency['/tools']?.avgMs, 20);
    assert.equal(snap.counters['tool.served'], 1);
  });
});
