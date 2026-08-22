import type { AgentConfiguration } from '@conduit/core';

/** Dashboard login state, from `GET /auth/session`. `required:false` means auth is disabled (open UI). */
export interface SessionState {
  required: boolean;
  authenticated: boolean;
  username: string | null;
}

/** One row of the agent registry, as returned by `GET /agents`. */
export interface AgentSummary {
  id: string;
  host_id: string;
  project_id: string | null;
  name: string | null;
  description: string | null;
  status: string;
  mode: string;
  created_at: string;
  activated_at: string | null;
  session_expires_at: string | null;
}

/** A governance project (`GET /projects`). */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
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
  project_id: string | null;
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
  projectId?: string | null;
}

export interface UpdateConnectionInput {
  name?: string;
  allowedOperations?: string[];
  authMethod?: string;
  /** Provide to rotate the stored secret; omit to leave it unchanged. */
  secret?: Record<string, string>;
  /** Move the connection to a project; null = global. */
  projectId?: string | null;
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
  adapter_config: Record<string, unknown>;
  schema_cached_at: string | null;
}

export type AdapterType = 'mcp' | 'openapi' | 'cli';

/** Input for registering a tool against an adapter (POST /tools). */
export interface RegisterToolInput {
  name: string;
  adapterType: AdapterType;
  adapterConfig: Record<string, unknown>;
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
  /** The grant's constraints (arg pins). Present so the UI can display + re-grant with the same scope. */
  constraints?: Record<string, unknown>;
  task_id: string | null;
  status: string;
  /** Server-computed risk level. */
  risk?: 'low' | 'med' | 'high';
  /** "Broken wire": the agent has connector authorizations but this grant's connection isn't among them. */
  blocked?: boolean;
}

/** Input for granting a capability to an agent (`POST /agent/grant`). */
export interface GrantCapabilityInput {
  agentId: string;
  capability: string;
  connectionId: string;
  operation: string;
  constraints?: Record<string, unknown>;
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
  projectId?: string | null;
}

/**
 * DashboardApi — a thin, typed client over the gateway's endpoints.
 * Holds no secrets; the host JWT used for registration is signed in the browser, not here.
 */
export interface DashboardApi {
  /** Whether login is required and, if so, whether the current session is authenticated. */
  getSession(): Promise<SessionState>;
  /** Log in with a username + password; the server sets an httpOnly session cookie. Throws on failure. */
  login(username: string, password: string): Promise<void>;
  /** Clear the session cookie. */
  logout(): Promise<void>;
  listAgents(): Promise<AgentSummary[]>;
  /** The gateway issuer (used as the host JWT `aud`). */
  getIssuer(): Promise<string>;
  /** The full AAP provider discovery document (§5.1). */
  getConfiguration(): Promise<AgentConfiguration>;
  registerAgent(hostJwt: string, input: RegisterAgentInput): Promise<RegisterResult>;
  revokeAgent(hostJwt: string, agentId: string): Promise<void>;
  updateAgent(hostJwt: string, agentId: string, name: string, description: string): Promise<void>;
  /** Reassign an agent to a project (or null = global). */
  setAgentProject(hostJwt: string, agentId: string, projectId: string | null): Promise<void>;
  listConnections(): Promise<ConnectionSummary[]>;
  registerConnection(hostJwt: string, input: RegisterConnectionInput): Promise<{ connection_id: string }>;
  updateConnection(hostJwt: string, id: string, patch: UpdateConnectionInput): Promise<void>;
  deleteConnection(hostJwt: string, id: string): Promise<void>;
  testConnection(hostJwt: string, id: string): Promise<CredentialTestResult>;
  listAudit(filter?: AuditFilter): Promise<AuditEntry[]>;
  listTools(): Promise<ToolSummary[]>;
  /** Register (or update) a tool bound to an adapter. Host-authorized. Re-registering a name updates it. */
  registerTool(hostJwt: string, input: RegisterToolInput): Promise<void>;
  /** Delete a registered tool by name. Host-authorized. */
  deleteTool(hostJwt: string, name: string): Promise<void>;
  /** Flush the per-tool schema cache (all tools). Host-authorized. */
  flushToolCache(hostJwt: string): Promise<void>;
  listConnectors(): Promise<ConnectorInfo[]>;
  listProjects(): Promise<Project[]>;
  createProject(hostJwt: string, name: string, description: string): Promise<{ id: string }>;
  deleteProject(hostJwt: string, id: string): Promise<void>;
  listAgentGrants(agentId: string): Promise<AgentGrant[]>;
  /** Grant (or replace) a capability for an agent, mapped to a connection + operation with constraints. */
  grantCapability(hostJwt: string, input: GrantCapabilityInput): Promise<void>;
  /** Revoke (deny) a single capability grant for an agent. Host-authorized. Takes effect on the next call. */
  revokeGrant(hostJwt: string, agentId: string, capability: string): Promise<void>;
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
    async getSession() {
      // Do NOT fail open here: if the gateway is down or running an old build without this route, we must
      // surface that (the App shows a "cannot reach gateway" screen) rather than silently exposing the UI.
      const res = await fetch(`${baseUrl}/auth/session`, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`auth/session -> ${res.status}`);
      }
      return (await res.json()) as SessionState;
    },

    async login(username, password) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `login failed (${res.status})`);
      }
    },

    async logout() {
      await fetch(`${baseUrl}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    },

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
          ...(input.projectId ? { project_id: input.projectId } : {}),
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

    async setAgentProject(hostJwt, agentId, projectId) {
      const res = await fetch(`${baseUrl}/agent/project`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, project_id: projectId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `reassign failed (${res.status})`);
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
          ...(input.projectId ? { project_id: input.projectId } : {}),
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

    async registerTool(hostJwt, input) {
      const res = await fetch(`${baseUrl}/tools`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          adapter_type: input.adapterType,
          adapter_config: input.adapterConfig,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `register tool failed (${res.status})`);
      }
    },

    async deleteTool(hostJwt, name) {
      const res = await fetch(`${baseUrl}/tools/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { authorization: `Bearer ${hostJwt}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `delete tool failed (${res.status})`);
      }
    },

    async flushToolCache(hostJwt) {
      const res = await fetch(`${baseUrl}/tools/flush`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { authorization: `Bearer ${hostJwt}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `flush cache failed (${res.status})`);
      }
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
          ...(patch.projectId !== undefined ? { project_id: patch.projectId } : {}),
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

    async grantCapability(hostJwt, input) {
      const res = await fetch(`${baseUrl}/agent/grant`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_id: input.agentId,
          capability: input.capability,
          connection_id: input.connectionId,
          operation: input.operation,
          constraints: input.constraints ?? {},
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `grant failed (${res.status})`);
      }
    },

    async revokeGrant(hostJwt, agentId, capability) {
      const res = await fetch(`${baseUrl}/agent/grant/revoke`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, capability }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `revoke grant failed (${res.status})`);
      }
    },

    async listAgentRisk() {
      const res = await fetch(`${baseUrl}/agents/risk`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/agents/risk -> ${res.status}`);
      }
      return ((await res.json()) as { agents: AgentRisk[] }).agents;
    },

    async listProjects() {
      const res = await fetch(`${baseUrl}/projects`);
      if (!res.ok) {
        throw new Error(`GET ${baseUrl}/projects -> ${res.status}`);
      }
      return ((await res.json()) as { projects: Project[] }).projects;
    },

    async createProject(hostJwt, name, description) {
      const res = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `create project failed (${res.status})`);
      }
      return { id: body.id ?? '' };
    },

    async deleteProject(hostJwt, id) {
      const res = await fetch(`${baseUrl}/projects/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${hostJwt}` } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `delete project failed (${res.status})`);
      }
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
