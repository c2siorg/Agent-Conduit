import type { AdapterType } from '@conduit/core';
import type { ToolAdapter } from './toolAdapter.js';

/**
 * AdapterRegistry — REGISTRY pattern. Resolves the adapter for a tool's origin type.
 * The Token Router uses this at schema-resolution time (step 4 of the schema flow).
 */
export interface AdapterRegistry {
  register(adapter: ToolAdapter): void;
  get(type: AdapterType): ToolAdapter | undefined;
}

/** Build a registry pre-loaded with the bundled adapters (mcp/openapi/cli). @remarks Stub. */
export function createAdapterRegistry(): AdapterRegistry {
  throw new Error('createAdapterRegistry not implemented');
}
