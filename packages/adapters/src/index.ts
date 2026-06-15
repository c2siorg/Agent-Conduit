/**
 * @conduit/adapters — tool-origin adapters behind one interface.
 * The agent talks to a single endpoint regardless of whether a tool came from MCP, OpenAPI, or a CLI.
 */
export * from './toolAdapter.js';
export * from './adapterRegistry.js';
export { McpAdapter } from './mcp/mcpAdapter.js';
export { OpenApiAdapter } from './openapi/openApiAdapter.js';
export { CliAdapter } from './cli/cliAdapter.js';
