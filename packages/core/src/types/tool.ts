/** Origin adapter kinds the Token Router normalizes from. */
export type AdapterType = 'mcp' | 'openapi' | 'cli';

/** Minimal, intentionally-open JSON-Schema shape carried through the router. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  [keyword: string]: unknown;
}

/**
 * Conduit's CANONICAL tool schema — the single normalized shape every adapter
 * (MCP / OpenAPI / CLI) maps into, so an agent always talks to one schema format.
 */
export interface CanonicalSchema {
  name: string;
  description: string;
  input: JsonSchema;
  output?: JsonSchema;
}

/** A registered tool, its adapter binding, and per-tool cache metadata. */
export interface Tool {
  id: string;
  name: string;
  adapterType: AdapterType;
  adapterConfig: Record<string, unknown>;
  /** Cached canonical schema (per-tool, never per-agent). */
  schemaCache: CanonicalSchema | null;
  schemaCachedAt: Date | null;
}
