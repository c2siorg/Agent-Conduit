import type { CanonicalSchema, JsonSchema } from '@conduit/core';
import type { RawSchema, ToolAdapter } from '../toolAdapter.js';

interface McpTool {
  name?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

/**
 * McpAdapter — bridges Model Context Protocol tool definitions into the canonical schema.
 * MCP tools already carry a JSON-Schema `inputSchema`, so normalization is a direct field mapping.
 * Config shape: `{ tool: { name, description, inputSchema, outputSchema? } }` (or the tool object itself).
 */
export class McpAdapter implements ToolAdapter {
  readonly type = 'mcp' as const;

  fetchSchema(config: Record<string, unknown>): Promise<RawSchema> {
    return Promise.resolve((config['tool'] ?? config) as McpTool);
  }

  normalize(raw: RawSchema): CanonicalSchema {
    const tool = (raw ?? {}) as McpTool;
    return {
      name: tool.name ?? '',
      description: tool.description ?? '',
      input: tool.inputSchema ?? { type: 'object' },
      ...(tool.outputSchema ? { output: tool.outputSchema } : {}),
    };
  }
}
