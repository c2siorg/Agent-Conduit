import type { AdapterRegistry } from '@conduit/adapters';
import { ConduitError, ErrorCode, type CanonicalSchema } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { Metrics } from '../observability/metrics.js';
import type { SchemaCache } from './schemaCache.js';

/** The router's result: the canonical schema, a token-cost estimate, and whether it was a cache hit. */
export interface ToolSchemaResult {
  schema: CanonicalSchema;
  tokenEstimate: number;
  cached: boolean;
}

/**
 * TokenRouter — the `GET /tools/:name` schema flow (after the JWT pipeline validates identity):
 *   1. introspect the agent's granted capabilities
 *   2. if the capability is NOT granted → 403, and the agent NEVER sees the schema
 *   3. resolve the tool's origin adapter (MCP / OpenAPI / CLI) and fetch the schema (per-tool cache)
 *   4. normalize to Conduit's canonical schema and return
 *   5. log the request: agent_id, tool name, timestamp, token estimate
 *
 * This solves MCP's full-schema-upfront waste: schemas are served on demand, identity-scoped.
 */
export interface TokenRouter {
  getToolSchema(agentId: string, toolName: string): Promise<ToolSchemaResult>;
}

export interface TokenRouterDeps {
  storage: StorageDriver;
  adapters: AdapterRegistry;
  cache: SchemaCache;
  metrics?: Metrics;
}

/** Rough token-cost estimate for a served schema (~4 chars/token). */
function estimateTokens(schema: CanonicalSchema): number {
  return Math.ceil(JSON.stringify(schema).length / 4);
}

export function createTokenRouter(deps: TokenRouterDeps): TokenRouter {
  const { storage, adapters, cache, metrics } = deps;
  return {
    async getToolSchema(agentId, toolName) {
      // 1-2. Access check FIRST — the agent must hold an active grant for this tool. If not, 403 and the
      // schema is never resolved or returned (identity-scoped filtering happens here, not in the cache).
      const grant = await storage.capabilityGrants.findActive(agentId, toolName);
      if (!grant) {
        throw new ConduitError(ErrorCode.capabilityNotGranted, `capability "${toolName}" is not granted`, 403);
      }

      // 3. Per-tool cache (never per-agent), then resolve the adapter on a miss.
      let schema = cache.get(toolName);
      let cached = true;
      if (!schema) {
        cached = false;
        const tool = await storage.tools.findByName(toolName);
        if (!tool) {
          throw new ConduitError(ErrorCode.invalidRequest, `tool "${toolName}" is not registered`, 404);
        }
        const adapter = adapters.get(tool.adapterType);
        if (!adapter) {
          throw new ConduitError(ErrorCode.internalError, `no adapter for type "${tool.adapterType}"`, 500);
        }
        // 4. Fetch native schema → normalize to canonical.
        const raw = await adapter.fetchSchema(tool.adapterConfig);
        schema = adapter.normalize(raw);
        cache.set(toolName, schema);
        await storage.tools.cacheSchema(toolName, schema, new Date());
      }

      const tokenEstimate = estimateTokens(schema);
      // 5. Log the served schema (agent_id, tool, token estimate).
      await storage.auditLog.append({
        agentId,
        hostId: null,
        eventType: 'tool.schema',
        capability: toolName,
        connectionId: null,
        operation: null,
        outcome: 'success',
        argsHash: null,
        durationMs: null,
      });
      metrics?.recordTokenEstimate(toolName, tokenEstimate);
      return { schema, tokenEstimate, cached };
    },
  };
}
