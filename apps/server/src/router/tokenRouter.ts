import type { CanonicalSchema } from '@conduit/core';

/**
 * TokenRouter — the `GET /tools/:name` schema flow (after the JWT pipeline validates identity):
 *   1. introspect the agent's granted capabilities
 *   2. if the capability is NOT granted → 403, and the agent NEVER sees the schema
 *   3. resolve the tool's origin adapter (MCP / OpenAPI / CLI) and fetch the schema (per-tool cache)
 *   4. normalize to Conduit's canonical schema and return
 *   5. log the request: agent_id, tool name, timestamp, token estimate
 *
 * This solves MCP's full-schema-upfront waste: schemas are served on demand, identity-scoped.
 * @remarks Stub.
 */
export interface TokenRouter {
  getToolSchema(agentId: string, toolName: string): Promise<CanonicalSchema>;
}
