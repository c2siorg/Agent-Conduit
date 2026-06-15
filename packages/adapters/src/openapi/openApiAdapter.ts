import type { CanonicalSchema } from '@conduit/core';
import type { RawSchema, ToolAdapter } from '../toolAdapter.js';

/**
 * OpenApiAdapter — maps an OpenAPI operation into the canonical schema.
 * @remarks Scaffold.
 */
export class OpenApiAdapter implements ToolAdapter {
  readonly type = 'openapi' as const;

  fetchSchema(_config: Record<string, unknown>): Promise<RawSchema> {
    throw new Error('OpenApiAdapter.fetchSchema not implemented');
  }
  normalize(_raw: RawSchema): CanonicalSchema {
    throw new Error('OpenApiAdapter.normalize not implemented');
  }
}
