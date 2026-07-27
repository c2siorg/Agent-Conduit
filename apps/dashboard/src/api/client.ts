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
  last_test_ok: boolean | null;
  last_test_at: string | null;
  last_test_detail: string | null;
}

export interface RegisterConnectionInput {
  name: string;
  platform: string;
  authMethod: string;
  secret: Record<string, string>;
  allowedOperations: string[];
}

export interface UpdateConnectionInput {
  name?: string;
  allowedOperations?: string[];
  authMethod?: string;
  /** Provide to rotate the stored secret; omit to leave it unchanged. */
  secret?: Record<string, string>;
}

/** Result of `POST /connections/:id/test`. */
export interface CredentialTestResult {
  ok: boolean;
  checked: 'structure' | 'live';
  detail: string;
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

/** A registered tool, as returned by `GET /tools` (names + adapter type only; never schemas). */
export interface ToolSummary {
  name: string;
  adapter_type: string;
  schema_cached_at: string | null;
}

/** One declarative policy rule. */
export interface PolicyRule {
  id: string;
  description?: string;
  effect: 'allow' | 'deny' | 'require_approval';
  agentModes?: string[];
  capabilities?: string[];
  platforms?: string[];
  operations?: string[];
  minRisk?: 'low' | 'med' | 'high';
}

/** Operator-toggleable runtime security settings (`GET`/`PATCH /admin/config`). */
export interface SecuritySettings {
  rateLimit: { enabled: boolean; perIpPerMinute: number; registerPerHourPerIp: number };
  ipFilter: { enabled: boolean; mode: 'allow' | 'deny'; entries: string[] };
  jwks: { allowPrivateHosts: boolean };
  dpop: { enabled: boolean };
  mtls: { enabled: boolean };
  policy: { enabled: boolean; defaultEffect: 'allow' | 'deny'; rules: PolicyRule[] };
}

export type SecuritySettingsPatch = {
  [K in keyof SecuritySettings]?: Partial<SecuritySettings[K]>;
};

/** One credential-form field for a connector. */
export interface ConnectorField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** An available connector platform, as returned by `GET /connectors`. */
export interface ConnectorInfo {
  platform: string;
  label: string;
  auth_methods: string[];
  docs_url: string | null;
  fields: ConnectorField[];
  operations: Array<{ name: string; description: string }>;
}

/** A capability grant for an agent (from `GET /agents/:id/grants`). */
export interface AgentGrant {
  capability: string;
  connection_id: string | null;
  operation: string | null;
  task_id: string | null;
  status: string;
  /** Server-computed risk level. */
  risk?: 'low' | 'med' | 'high';
  /** "Broken wire": the agent has connector authorizations but this grant's connection isn't among them. */
  blocked?: boolean;
}

/** A connector an agent is authorized to use (`GET /agents/:id/connections`). */
export interface AgentConnection {
  connection_id: string;
  name: string;
  platform: string;
  allowed_operations: string[];
  rate_limit: number | null;
}

export interface AttachConnectionInput {
  connectionId: string;
  allowedOperations?: string[];
  rateLimit?: number | null;
}

/** Per-agent blast radius (`GET /agents/risk`). */
export interface AgentRisk {
  agent_id: string;
  active_grants: number;
  blast_radius: number;
  level: 'low' | 'med' | 'high';
}

/** Compliance posture (`GET /compliance`). */
export interface ComplianceControl {
  id: string;
  title: string;
  status: 'met' | 'partial' | 'gap';
  detail: string;
}
export interface ComplianceReport {
  summary: { met: number; partial: number; gap: number; total: number };
  domains: Array<{ domain: string; controls: ComplianceControl[] }>;
}

/** Token/latency telemetry snapshot from `GET /metrics`. */
export interface MetricsSnapshot {
  counters: Record<string, number>;
  latency: Record<string, { count: number; avgMs: number; maxMs: number }>;
  tokensByTool: Record<string, { calls: number; totalTokens: number }>;
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
  updateConnection(hostJwt: string, id: string, patch: UpdateConnectionInput): Promise<void>;
  deleteConnection(hostJwt: string, id: string): Promise<void>;
  testConnection(hostJwt: string, id: string): Promise<CredentialTestResult>;
  listAudit(filter?: AuditFilter): Promise<AuditEntry[]>;
  listTools(): Promise<ToolSummary[]>;
  listConnectors(): Promise<ConnectorInfo[]>;
  listAgentGrants(agentId: string): Promise<AgentGrant[]>;
  listAgentRisk(): Promise<AgentRisk[]>;
  listAgentConnections(agentId: string): Promise<AgentConnection[]>;
  attachConnection(hostJwt: string, agentId: string, input: AttachConnectionInput): Promise<void>;
  detachConnection(hostJwt: string, agentId: string, connectionId: string): Promise<void>;
  getCompliance(): Promise<ComplianceReport>;
  getMetrics(): Promise<MetricsSnapshot>;
  getSecuritySettings(hostJwt: string): Promise<SecuritySettings>;
  updateSecuritySettings(hostJwt: string, patch: SecuritySettingsPatch): Promise<SecuritySettings>;
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

    async listTools() {
      const res = await fetch(`${baseUrl}/tools`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/tools -> ${res.status}`);
      }
      return ((await res.json()) as { tools: ToolSummary[] }).tools;
    },

    async updateConnection(hostJwt, id, patch) {
      const res = await fetch(`${baseUrl}/connections/${id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.allowedOperations !== undefined ? { allowed_operations: patch.allowedOperations } : {}),
          ...(patch.authMethod !== undefined ? { auth_method: patch.authMethod } : {}),
          ...(patch.secret !== undefined ? { secret: patch.secret } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `update connection failed (${res.status})`);
      }
    },

    async deleteConnection(hostJwt, id) {
      const res = await fetch(`${baseUrl}/connections/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${hostJwt}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `delete connection failed (${res.status})`);
      }
    },

    async testConnection(hostJwt, id) {
      const res = await fetch(`${baseUrl}/connections/${id}/test`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}` },
      });
      const body = (await res.json().catch(() => ({}))) as CredentialTestResult & { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `test failed (${res.status})`);
      }
      return body;
    },

    async listConnectors() {
      const res = await fetch(`${baseUrl}/connectors`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/connectors -> ${res.status}`);
      }
      return ((await res.json()) as { connectors: ConnectorInfo[] }).connectors;
    },

    async listAgentGrants(agentId) {
      const res = await fetch(`${baseUrl}/agents/${agentId}/grants`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/agents/${agentId}/grants -> ${res.status}`);
      }
      return ((await res.json()) as { grants: AgentGrant[] }).grants;
    },

    async listAgentRisk() {
      const res = await fetch(`${baseUrl}/agents/risk`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/agents/risk -> ${res.status}`);
      }
      return ((await res.json()) as { agents: AgentRisk[] }).agents;
    },

    async listAgentConnections(agentId) {
      const res = await fetch(`${baseUrl}/agents/${agentId}/connections`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/agents/${agentId}/connections -> ${res.status}`);
      }
      return ((await res.json()) as { connections: AgentConnection[] }).connections;
    },

    async attachConnection(hostJwt, agentId, input) {
      const res = await fetch(`${baseUrl}/agents/${agentId}/connections`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          connection_id: input.connectionId,
          ...(input.allowedOperations !== undefined ? { allowed_operations: input.allowedOperations } : {}),
          ...(input.rateLimit !== undefined ? { rate_limit: input.rateLimit } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `attach failed (${res.status})`);
      }
    },

    async detachConnection(hostJwt, agentId, connectionId) {
      const res = await fetch(`${baseUrl}/agents/${agentId}/connections/${connectionId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${hostJwt}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `detach failed (${res.status})`);
      }
    },

    async getCompliance() {
      const res = await fetch(`${baseUrl}/compliance`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/compliance -> ${res.status}`);
      }
      return (await res.json()) as ComplianceReport;
    },

    async getMetrics() {
      const res = await fetch(`${baseUrl}/metrics`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/metrics -> ${res.status}`);
      }
      return (await res.json()) as MetricsSnapshot;
    },

    async getSecuritySettings(hostJwt) {
      const res = await fetch(`${baseUrl}/admin/config`, { headers: { authorization: `Bearer ${hostJwt}` } });
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/admin/config -> ${res.status}`);
      }
      return (await res.json()) as SecuritySettings;
    },

    async updateSecuritySettings(hostJwt, patch) {
      const res = await fetch(`${baseUrl}/admin/config`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as SecuritySettings & { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `PATCH admin/config -> ${res.status}`);
      }
      return body;
    },
  };
}
