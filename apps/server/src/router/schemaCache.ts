import type { CanonicalSchema } from '@conduit/core';

/**
 * SchemaCache — in-memory, configurable TTL, keyed PER-TOOL (never per-agent).
 *
 * Identity-scoped filtering happens at the access-check step of the router, NEVER inside the cache.
 * Invalidate on tool-registration changes or an explicit admin flush.
 */
export interface SchemaCache {
  get(toolName: string): CanonicalSchema | undefined;
  set(toolName: string, schema: CanonicalSchema): void;
  invalidate(toolName: string): void;
  /** Admin flush — clear the entire cache. */
  flush(): void;
}

/** Build a TTL cache. @remarks Stub. */
export function createSchemaCache(_ttlSeconds: number): SchemaCache {
  throw new Error('createSchemaCache not implemented');
}
