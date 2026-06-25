import type { AgentConfiguration } from '@conduit/core';

/** One row of the agent registry, as returned by `GET /agents`. */
export interface AgentSummary {
  id: string;
  host_id: string;
  name: string | null;
  description: string | null;
  status: string;
  mode: string;
  created_at: string;
  activated_at: string | null;
  session_expires_at: string | null;
}

export interface RegisterResult {
  agent_id: string;
  status: string;
  mode: string;
}

/** A connection-vault entry, as returned by `GET /connections`. Credential VALUES are never included. */
export interface ConnectionSummary {
  id: string;
  name: string;
  platform: string;
  allowed_operations: string[];
  created_at: string;
}

export interface RegisterConnectionInput {
  name: string;
  platform: string;
  authMethod: string;
  secret: Record<string, string>;
  allowedOperations: string[];
}

/** One audit entry, as returned by `GET /audit`. `args_hash` is a hash — raw args are never stored. */
export interface AuditEntry {
  id: string;
  agent_id: string | null;
  event_type: string;
  capability: string | null;
  connection_id: string | null;
  operation: string | null;
  outcome: string;
  args_hash: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface AuditFilter {
  agentId?: string;
  outcome?: string;
}

export interface RegisterAgentInput {
  agentPublicKey: object;
  mode: string;
  name?: string;
  description?: string;
}

/**
 * DashboardApi — a thin, typed client over the gateway's endpoints.
 * Holds no secrets; the host JWT used for registration is signed in the browser, not here.
 */
export interface DashboardApi {
  listAgents(): Promise<AgentSummary[]>;
  /** The gateway issuer (used as the host JWT `aud`). */
  getIssuer(): Promise<string>;
  /** The full AAP provider discovery document (§5.1). */
  getConfiguration(): Promise<AgentConfiguration>;
  registerAgent(hostJwt: string, input: RegisterAgentInput): Promise<RegisterResult>;
  revokeAgent(hostJwt: string, agentId: string): Promise<void>;
  updateAgent(hostJwt: string, agentId: string, name: string, description: string): Promise<void>;
  listConnections(): Promise<ConnectionSummary[]>;
  registerConnection(hostJwt: string, input: RegisterConnectionInput): Promise<{ connection_id: string }>;
  listAudit(filter?: AuditFilter): Promise<AuditEntry[]>;
}

/** Build a client bound to the gateway base path (defaults to `/api`, proxied to the gateway). */
export function createDashboardApi(baseUrl = '/api'): DashboardApi {
  return {
    async listAgents() {
      const res = await fetch(`${baseUrl}/agents`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/agents -> ${res.status}`);
      }
      const body = (await res.json()) as { agents: AgentSummary[] };
      return body.agents;
    },

    async getIssuer() {
      return (await this.getConfiguration()).issuer;
    },

    async getConfiguration() {
      const res = await fetch(`${baseUrl}/.well-known/agent-configuration`);
      if (!res.ok) {
        throw new Error(`discovery -> ${res.status}`);
      }
      return (await res.json()) as AgentConfiguration;
    },

    async registerAgent(hostJwt, input) {
      const res = await fetch(`${baseUrl}/agent/register`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_public_key: input.agentPublicKey,
          mode: input.mode,
          name: input.name,
          description: input.description,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        agent_id?: string;
        status?: string;
        mode?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? `register failed (${res.status})`);
      }
      return { agent_id: body.agent_id ?? '', status: body.status ?? '', mode: body.mode ?? '' };
    },

    async revokeAgent(hostJwt, agentId) {
      const res = await fetch(`${baseUrl}/agent/revoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `revoke failed (${res.status})`);
      }
    },

    async updateAgent(hostJwt, agentId, name, description) {
      const res = await fetch(`${baseUrl}/agent/update`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, name, description }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `update failed (${res.status})`);
      }
    },

    async listConnections() {
      const res = await fetch(`${baseUrl}/connections`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/connections -> ${res.status}`);
      }
      const body = (await res.json()) as { connections: ConnectionSummary[] };
      return body.connections;
    },

    async registerConnection(hostJwt, input) {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          platform: input.platform,
          auth_method: input.authMethod,
          secret: input.secret,
          allowed_operations: input.allowedOperations,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; connection_id?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `register connection failed (${res.status})`);
      }
      return { connection_id: body.connection_id ?? '' };
    },

    async listAudit(filter) {
      const params = new URLSearchParams();
      if (filter?.agentId) {
        params.set('agent_id', filter.agentId);
      }
      if (filter?.outcome) {
        params.set('outcome', filter.outcome);
      }
      const qs = params.toString();
      const res = await fetch(`${baseUrl}/audit${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/audit -> ${res.status}`);
      }
      const body = (await res.json()) as { entries: AuditEntry[] };
      return body.entries;
    },
  };
}
