import type { CanonicalSchema } from '@conduit/core';
import type { RawSchema, ToolAdapter } from '../toolAdapter.js';

/**
 * CliAdapter — describes a CLI command (flags/args) as the canonical schema.
 * @remarks Scaffold.
 */
export class CliAdapter implements ToolAdapter {
  readonly type = 'cli' as const;

  fetchSchema(_config: Record<string, unknown>): Promise<RawSchema> {
    throw new Error('CliAdapter.fetchSchema not implemented');
  }
  normalize(_raw: RawSchema): CanonicalSchema {
    throw new Error('CliAdapter.normalize not implemented');
  }
}
