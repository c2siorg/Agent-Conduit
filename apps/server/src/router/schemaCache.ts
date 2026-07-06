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

/** Build a TTL cache (per-tool). A non-positive TTL disables caching (always a miss). */
export function createSchemaCache(ttlSeconds: number): SchemaCache {
  const store = new Map<string, { schema: CanonicalSchema; expiresAt: number }>();
  return {
    get(toolName) {
      const entry = store.get(toolName);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= Date.now()) {
        store.delete(toolName);
        return undefined;
      }
      return entry.schema;
    },
    set(toolName, schema) {
      if (ttlSeconds <= 0) {
        return;
      }
      store.set(toolName, { schema, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    invalidate(toolName) {
      store.delete(toolName);
    },
    flush() {
      store.clear();
    },
  };
}
