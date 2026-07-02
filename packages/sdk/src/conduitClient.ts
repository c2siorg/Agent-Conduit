import { randomUUID } from 'node:crypto';
import { createJwtSigner, generateEd25519KeyPair, jwkThumbprint } from '@conduit/crypto';
import type { CanonicalSchema, GrantStatus, Jwk } from '@conduit/core';

/** Client construction options. The host PRIVATE key stays in the client and is never transmitted. */
export interface ConduitClientOptions {
  /** Gateway base URL (the AAP `issuer`). */
  baseUrl: string;
  /** Host private JWK — used to sign host JWTs locally. */
  hostPrivateKeyJwk: Jwk;
}

/** Result of connecting (registering + activating) an agent. */
export interface ConnectAgentResult {
  agentId: string;
  status: string;
}

export interface CapabilitySummary {
  name: string;
  description?: string;
  grant_status?: string;
}

export interface AgentStatus {
  agent_id: string;
  status: string;
  agent_capability_grants: Array<{ capability: string; status: GrantStatus }>;
}

const JWT_TTL_SECONDS = 60;

/**
 * ConduitClient — the AAP **Client** role (§6).
 *
 * Holds the host identity, manages agent keypairs in memory, and mints a FRESH short-lived agent JWT per
 * call (execute / status / router / poll). Private keys never leave this client.
 */
export class ConduitClient {
  private readonly baseUrl: string;
  private readonly hostKey: Jwk;
  private readonly hostThumbprint: string;
  private readonly signer = createJwtSigner();
  private readonly agentKeys = new Map<string, Jwk>();
  private issuer: string | undefined;

  constructor(options: ConduitClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.hostKey = options.hostPrivateKeyJwk;
    this.hostThumbprint = jwkThumbprint({ kty: this.hostKey.kty, crv: this.hostKey.crv, x: this.hostKey.x } as Jwk);
  }

  /** connect_agent (§6.4) — generate an agent keypair, register it under the host, keep the private key. */
  async connectAgent(capabilities: string[] = []): Promise<ConnectAgentResult> {
    const agent = generateEd25519KeyPair();
    const body = await this.call<{ agent_id: string; status: string }>('POST', '/agent/register', await this.hostJwt(), {
      agent_public_key: agent.publicKeyJwk,
      mode: 'delegated',
      capabilities,
    });
    this.agentKeys.set(body.agent_id, agent.privateKeyJwk);
    return { agentId: body.agent_id, status: body.status };
  }

  /** sign_jwt (§6.5) — mint a raw agent JWT (fresh, short-lived) with optional `aud` + capability restriction. */
  async signJwt(agentId: string, opts?: { aud?: string; capabilities?: string[] }): Promise<string> {
    const key = this.agentKeys.get(agentId);
    if (!key) {
      throw new Error(`unknown agent "${agentId}" — connect it through this client first`);
    }
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: this.hostThumbprint,
      sub: agentId,
      aud: opts?.aud ?? (await this.discoverIssuer()),
      iat: now,
      exp: now + JWT_TTL_SECONDS,
      jti: randomUUID(),
    };
    if (opts?.capabilities) {
      claims['capabilities'] = opts.capabilities;
    }
    return this.signer.sign('agent+jwt', claims as never, key as never);
  }

  /** request_capability (§6.6) — request a capability for a connected agent (creates a pending grant). */
  async requestCapability(agentId: string, capability: string, constraints: Record<string, unknown> = {}): Promise<unknown> {
    return this.call('POST', '/agent/request-capability', await this.signJwt(agentId), {
      capabilities: [{ name: capability, constraints }],
    });
  }

  /** disconnect_agent (§6.7) — revoke the agent (host-authorized). */
  async disconnectAgent(agentId: string): Promise<void> {
    await this.call('POST', '/agent/revoke', await this.hostJwt(), { agent_id: agentId });
    this.agentKeys.delete(agentId);
  }

  /** reactivate_agent (§6.8) — reactivate an expired agent (host-authorized). */
  async reactivateAgent(agentId: string): Promise<void> {
    await this.call('POST', '/agent/reactivate', await this.hostJwt(), { agent_id: agentId });
  }

  /** agent_status (§6.9) — lifecycle state + grants (also used to poll approvals). */
  async agentStatus(agentId: string): Promise<AgentStatus> {
    return this.call<AgentStatus>('GET', '/agent/status', await this.signJwt(agentId));
  }

  /** execute_capability (§6.10) — mint a fresh agent JWT, then execute. Returns the platform result data. */
  async executeCapability(agentId: string, capability: string, args: Record<string, unknown>): Promise<unknown> {
    const body = await this.call<{ data: unknown }>('POST', '/capability/execute', await this.signJwt(agentId), {
      capability,
      args,
    });
    return body.data;
  }

  /** list_capabilities (§6.3) — identity-scoped list of capabilities + grant status. */
  async listCapabilities(agentId: string): Promise<CapabilitySummary[]> {
    const body = await this.call<{ capabilities: CapabilitySummary[] }>(
      'GET',
      '/capability/list',
      await this.signJwt(agentId),
    );
    return body.capabilities;
  }

  /** describe_capability (§6.3.1) — schema + grant status for one capability. */
  async describeCapability(agentId: string, name: string): Promise<CapabilitySummary> {
    return this.call<CapabilitySummary>(
      'GET',
      `/capability/describe?name=${encodeURIComponent(name)}`,
      await this.signJwt(agentId),
    );
  }

  /** get_tool — the Token Router: fetch a tool's canonical schema on demand, identity-scoped. */
  async getToolSchema(agentId: string, toolName: string): Promise<CanonicalSchema & { token_estimate: number }> {
    return this.call('GET', `/tools/${encodeURIComponent(toolName)}`, await this.signJwt(agentId));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async discoverIssuer(): Promise<string> {
    if (this.issuer) {
      return this.issuer;
    }
    const res = await fetch(`${this.baseUrl}/.well-known/agent-configuration`);
    if (!res.ok) {
      throw new Error(`discovery failed: ${res.status}`);
    }
    const cfg = (await res.json()) as { issuer: string };
    this.issuer = cfg.issuer;
    return cfg.issuer;
  }

  private async hostJwt(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return this.signer.sign(
      'host+jwt',
      {
        iss: this.hostThumbprint,
        aud: await this.discoverIssuer(),
        iat: now,
        exp: now + JWT_TTL_SECONDS,
        jti: randomUUID(),
      } as never,
      this.hostKey as never,
    );
  }

  private async call<T = unknown>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const message = (parsed as { message?: string } | undefined)?.message ?? `${method} ${path} -> ${res.status}`;
      throw new Error(message);
    }
    return parsed as T;
  }
}
