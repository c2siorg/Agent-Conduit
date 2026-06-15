import type { AdapterType, CanonicalSchema } from '@conduit/core';

/** Raw, un-normalized schema as fetched from an origin (MCP / OpenAPI / CLI). */
export type RawSchema = unknown;

/**
 * ToolAdapter — the ADAPTER pattern.
 * Each origin fetches its native schema and NORMALIZES it into Conduit's canonical shape,
 * so the agent always sees one schema format regardless of where the tool came from.
 */
export interface ToolAdapter {
  readonly type: AdapterType;
  /** Fetch the origin's native schema for the tool described by `config`. */
  fetchSchema(config: Record<string, unknown>): Promise<RawSchema>;
  /** Map the native schema → Conduit canonical schema. */
  normalize(raw: RawSchema): CanonicalSchema;
}
