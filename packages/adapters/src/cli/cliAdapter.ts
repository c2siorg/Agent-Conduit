import type { CanonicalSchema, JsonSchema } from '@conduit/core';
import type { RawSchema, ToolAdapter } from '../toolAdapter.js';

interface CliOption {
  name?: string;
  type?: string;
  required?: boolean;
  description?: string;
}

interface CliConfig {
  command?: string;
  description?: string;
  options?: CliOption[];
}

/**
 * CliAdapter — describes a CLI command (flags/options) as the canonical schema. Each option becomes a
 * property of the canonical input object.
 * Config shape: `{ command, description?, options?: [{ name, type?, required?, description? }] }`.
 */
export class CliAdapter implements ToolAdapter {
  readonly type = 'cli' as const;

  fetchSchema(config: Record<string, unknown>): Promise<RawSchema> {
    return Promise.resolve(config as CliConfig);
  }

  normalize(raw: RawSchema): CanonicalSchema {
    const cfg = (raw ?? {}) as CliConfig;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const option of cfg.options ?? []) {
      if (!option.name) {
        continue;
      }
      properties[option.name] = {
        type: option.type ?? 'string',
        ...(option.description ? { description: option.description } : {}),
      };
      if (option.required) {
        required.push(option.name);
      }
    }

    const input: JsonSchema = { type: 'object', properties };
    if (required.length > 0) {
      input.required = required;
    }
    return {
      name: cfg.command ?? '',
      description: cfg.description ?? '',
      input,
    };
  }
}
