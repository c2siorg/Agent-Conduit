import type { CanonicalSchema } from '@conduit/core';
import type { RawSchema, ToolAdapter } from '../toolAdapter.js';

/**
 * McpAdapter — bridges Model Context Protocol tool definitions into the canonical schema.
 * @remarks Scaffold.
 */
export class McpAdapter implements ToolAdapter {
  readonly type = 'mcp' as const;

  fetchSchema(_config: Record<string, unknown>): Promise<RawSchema> {
    throw new Error('McpAdapter.fetchSchema not implemented');
  }
  normalize(_raw: RawSchema): CanonicalSchema {
    throw new Error('McpAdapter.normalize not implemented');
  }
}
