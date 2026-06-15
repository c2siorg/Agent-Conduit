import type { Agent, AuditEntry, Connection, Tool } from '@conduit/core';

/**
 * DashboardApi — a thin, typed client over the gateway's admin/observability endpoints.
 * Imports shared types from `@conduit/core` so the UI never drifts from the server contract.
 * Holds no secrets and performs admin actions through documented endpoints only.
 * @remarks Stub.
 */
export interface DashboardApi {
  listAgents(): Promise<Agent[]>;
  listConnections(): Promise<Connection[]>;
  listTools(): Promise<Tool[]>;
  queryAudit(params: Record<string, string>): Promise<AuditEntry[]>;
}

/** Build a client bound to the gateway base URL (defaults to the same origin / `/api`). */
export function createDashboardApi(_baseUrl: string): DashboardApi {
  throw new Error('createDashboardApi not implemented');
}
