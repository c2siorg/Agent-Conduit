import type { AdapterType } from '@conduit/core';
import { CliAdapter } from './cli/cliAdapter.js';
import { McpAdapter } from './mcp/mcpAdapter.js';
import { OpenApiAdapter } from './openapi/openApiAdapter.js';
import type { ToolAdapter } from './toolAdapter.js';

/**
 * AdapterRegistry — REGISTRY pattern. Resolves the adapter for a tool's origin type.
 * The Token Router uses this at schema-resolution time (step 4 of the schema flow).
 */
export interface AdapterRegistry {
  register(adapter: ToolAdapter): void;
  get(type: AdapterType): ToolAdapter | undefined;
}

/** Build a registry pre-loaded with the bundled adapters (mcp/openapi/cli). */
export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<AdapterType, ToolAdapter>();
  for (const adapter of [new McpAdapter(), new OpenApiAdapter(), new CliAdapter()]) {
    adapters.set(adapter.type, adapter);
  }
  return {
    register(adapter) {
      adapters.set(adapter.type, adapter);
    },
    get(type) {
      return adapters.get(type);
    },
  };
}
