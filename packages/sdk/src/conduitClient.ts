import type { Capability, GrantStatus } from '@conduit/core';

/**
 * Client construction options. The host PRIVATE key stays in the client and is never transmitted.
 */
export interface ConduitClientOptions {
  /** Gateway base URL (the AAP `issuer`). */
  baseUrl: string;
  /** Host private JWK — used to sign host JWTs locally. */
  hostPrivateKeyJwk: Record<string, unknown>;
  /** Optional: pin to a discovered configuration to avoid re-discovery each call. */
  discoveryCacheTtlSeconds?: number;
}

/** Result of connecting (registering + activating) an agent. */
export interface ConnectAgentResult {
  agentId: string;
  status: string;
  grants: Array<{ capability: string; status: GrantStatus }>;
}

/**
 * ConduitClient — the AAP **Client** role (§6).
 *
 * Responsibilities: hold the host identity, manage host/agent keypairs, mint a FRESH agent JWT
 * per execute/poll, and auto-refresh on expiry. Private keys never leave this client.
 *
 * Method names are camelCase; each maps to a named AAP client tool (cited per method).
 * @remarks Scaffold — every method is stubbed.
 */
export class ConduitClient {
  constructor(private readonly options: ConduitClientOptions) {}

  /** connect_agent (§6.4) — register an agent under the host and drive approval. */
  connectAgent(_capabilities: string[]): Promise<ConnectAgentResult> {
    throw new Error('ConduitClient.connectAgent not implemented');
  }

  /** request_capability (§6.6) — request an additional capability for a connected agent. */
  requestCapability(_agentId: string, _capability: string): Promise<void> {
    throw new Error('ConduitClient.requestCapability not implemented');
  }

  /** disconnect_agent (§6.7) — revoke the agent. */
  disconnectAgent(_agentId: string): Promise<void> {
    throw new Error('ConduitClient.disconnectAgent not implemented');
  }

  /** reactivate_agent (§6.8) — reactivate an expired agent (decays caps to host defaults). */
  reactivateAgent(_agentId: string): Promise<void> {
    throw new Error('ConduitClient.reactivateAgent not implemented');
  }

  /** agent_status (§6.9) — fetch lifecycle state + grants (also used to poll approvals). */
  agentStatus(_agentId: string): Promise<{ status: string }> {
    throw new Error('ConduitClient.agentStatus not implemented');
  }

  /** execute_capability (§6.10) — mints a fresh agent JWT, then executes. */
  executeCapability(_agentId: string, _capability: string, _args: Record<string, unknown>): Promise<unknown> {
    throw new Error('ConduitClient.executeCapability not implemented');
  }

  /** sign_jwt (§6.5) — mint a raw agent JWT with optional `aud` + `capabilities` restriction. */
  signJwt(_agentId: string, _opts?: { aud?: string; capabilities?: string[] }): Promise<string> {
    throw new Error('ConduitClient.signJwt not implemented');
  }

  /** list_capabilities (§6.3) — discover capabilities (optionally identity-scoped). */
  listCapabilities(_query?: string): Promise<Capability[]> {
    throw new Error('ConduitClient.listCapabilities not implemented');
  }

  /** describe_capability (§6.3.1) — full input/output schema for one capability. */
  describeCapability(_name: string): Promise<Capability> {
    throw new Error('ConduitClient.describeCapability not implemented');
  }
}
