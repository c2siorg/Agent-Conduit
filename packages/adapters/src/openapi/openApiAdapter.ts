import type { CanonicalSchema, JsonSchema } from '@conduit/core';
import type { RawSchema, ToolAdapter } from '../toolAdapter.js';

interface OpenApiParam {
  name?: string;
  required?: boolean;
  schema?: JsonSchema;
  description?: string;
  in?: string;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
}

interface OpenApiConfig {
  name?: string;
  operation?: OpenApiOperation;
}

/**
 * OpenApiAdapter — maps an OpenAPI operation into the canonical schema. Path/query parameters and the
 * JSON request-body schema are merged into a single canonical input object.
 * Config shape: `{ name?, operation: { operationId?, summary?, parameters?, requestBody? } }`.
 */
export class OpenApiAdapter implements ToolAdapter {
  readonly type = 'openapi' as const;

  fetchSchema(config: Record<string, unknown>): Promise<RawSchema> {
    return Promise.resolve(config as OpenApiConfig);
  }

  normalize(raw: RawSchema): CanonicalSchema {
    const cfg = (raw ?? {}) as OpenApiConfig;
    const op = cfg.operation ?? {};
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const param of op.parameters ?? []) {
      if (!param.name) {
        continue;
      }
      properties[param.name] = {
        ...(param.schema ?? { type: 'string' }),
        ...(param.description ? { description: param.description } : {}),
      };
      if (param.required) {
        required.push(param.name);
      }
    }

    const bodySchema = op.requestBody?.content?.['application/json']?.schema;
    if (bodySchema?.properties) {
      for (const [key, value] of Object.entries(bodySchema.properties)) {
        properties[key] = value;
      }
      for (const req of bodySchema.required ?? []) {
        required.push(req);
      }
    }

    const input: JsonSchema = { type: 'object', properties };
    if (required.length > 0) {
      input.required = required;
    }
    return {
      name: cfg.name ?? op.operationId ?? '',
      description: op.summary ?? op.description ?? '',
      input,
    };
  }
}
