import type { Agent, AgentMode, Host, Jwk } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';

/** Inputs for agent registration (AAP §5.3). Key delivery is inline JWK OR JWKS URL — never both. */
export interface RegisterAgentInput {
  /** The authorizing `host+jwt`. */
  hostJwt: string;
  agentPublicKeyJwk?: Jwk;
  agentJwksUrl?: string;
  agentKid?: string;
  mode: AgentMode;
  requestedCapabilities: string[];
}

/**
 * IdentityService — orchestrates the full host/agent lifecycle (AAP §2, §5.3–5.10).
 *
 * Routes EVERY status change through the state machines. Owns the linking/claiming subsystem
 * and the three lifetime clocks. Revoking one agent never touches the host or siblings; host
 * revocation cascades to its agents.
 * @remarks Scaffold — all methods stubbed.
 */
export interface IdentityService {
  // Agent lifecycle
  registerAgent(input: RegisterAgentInput): Promise<Agent>;
  approveAgent(agentId: string, grantedBy: string): Promise<void>;
  rejectAgent(agentId: string, deniedBy: string, reason: string): Promise<void>;
  getAgentStatus(agentId: string): Promise<Agent>;
  reactivateAgent(agentId: string): Promise<Agent>;
  revokeAgent(agentId: string): Promise<void>;
  rotateAgentKey(agentId: string, newKey: Jwk): Promise<void>;

  // Host lifecycle
  registerHost(publicKey: Jwk | string, mode: AgentMode): Promise<Host>;
  approveHost(hostId: string): Promise<void>;
  revokeHost(hostId: string): Promise<{ agentsRevoked: number }>;
  rotateHostKey(hostId: string, newKey: Jwk): Promise<void>;

  // Linking subsystem (AAP §2.9–§2.10)
  linkHost(hostId: string, userId: string): Promise<void>;
  /** MUST revoke all delegated agents under the host. */
  unlinkHost(hostId: string): Promise<void>;
  /** Keeps host_id + keys, changes only user_id; agents MUST re-register. */
  switchAccount(hostId: string, userId: string): Promise<void>;
  /** On host linking: revoke caps, set active autonomous agents → `claimed` (terminal). */
  claimAutonomousAgents(hostId: string): Promise<number>;
}

/** Build the identity service over a storage driver. @remarks Stub. */
export function createIdentityService(_storage: StorageDriver): IdentityService {
  throw new Error('createIdentityService not implemented');
}
