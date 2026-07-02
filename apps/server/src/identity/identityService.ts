import { decodeJwt, type JwtVerifier } from '@conduit/crypto';
import { ConduitError, ErrorCode } from '@conduit/core';
import type { Agent, AgentMode, CapabilityGrant, Constraint, Host, Jwk } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { StateMachine } from './stateMachine.js';

/** RFC 7662 / AAP §5.12 introspection response for an agent token. */
export interface IntrospectionResult {
  active: boolean;
  sub?: string | undefined;
  iss?: string | undefined;
  aud?: string | undefined;
  exp?: number | undefined;
  iat?: number | undefined;
  jti?: string | undefined;
  typ?: string | undefined;
  agent_status?: string | undefined;
  mode?: string | undefined;
  capabilities?: string[] | undefined;
}

/** Inputs for agent registration (the host is already authenticated by the host pipeline). */
export interface RegisterAgentInput {
  /** The agent's PUBLIC key (private key never leaves the client). */
  publicKeyJwk: Jwk;
  mode: AgentMode;
  requestedCapabilities: string[];
  /** Operator-facing label + note (not part of the AAP protocol). */
  name?: string;
  description?: string;
}

/** The three lifetime clocks, in seconds, applied on activation (AAP §2.4). */
export interface AgentLifetimeConfig {
  sessionTtlSeconds: number;
  maxLifetimeSeconds: number;
  absoluteLifetimeSeconds: number;
}

export interface GrantCapabilityInput {
  agentId: string;
  capability: string;
  connectionId: string | null;
  operation: string | null;
  constraints: Record<string, Constraint>;
}

/** One capability an agent asks for via `POST /agent/request-capability` (AAP §5.4). */
export interface CapabilityRequest {
  name: string;
  constraints: Record<string, Constraint>;
}

export interface IdentityServiceDeps {
  storage: StorageDriver;
  stateMachine: StateMachine;
  lifetimes: AgentLifetimeConfig;
  verifier: JwtVerifier;
  /** Expected `aud` for tokens (the gateway issuer) - used by introspection. */
  issuer: string;
}

/**
 * IdentityService — orchestrates host/agent lifecycle. Routes every status change through the state
 * machine. Sprint 1 implements registration, status, and revoke; the rest lands in later sprints.
 */
export interface IdentityService {
  registerAgent(hostId: string, input: RegisterAgentInput): Promise<Agent>;
  getAgentStatus(agentId: string): Promise<Agent>;
  /** Revoke an agent owned by `hostId` (idempotent). Routes the transition through the state machine. */
  revokeAgent(hostId: string, agentId: string): Promise<void>;
  /** Update operator-facing name/description for an agent owned by `hostId`. */
  updateAgentMetadata(
    hostId: string,
    agentId: string,
    name: string | null,
    description: string | null,
  ): Promise<void>;
  /** Grant (or replace) a capability for an agent owned by `hostId`, mapping it to connection+operation. */
  grantCapability(hostId: string, input: GrantCapabilityInput): Promise<CapabilityGrant>;
  /**
   * Agent self-service capability request (AAP §5.4). Already-active capabilities are returned as-is
   * (auto-approved); the rest become `pending` grants awaiting operator approval (the operator approves
   * by mapping each to a connection+operation via `grantCapability`).
   */
  requestCapability(agentId: string, requests: CapabilityRequest[]): Promise<CapabilityGrant[]>;
  /** All capability grants for an agent, any status (drives `/agent/status` and `/capability/list`). */
  listGrants(agentId: string): Promise<CapabilityGrant[]>;
  /** Reactivate an expired agent (AAP §2.5): resets session + max clocks, never the absolute clock. */
  reactivateAgent(hostId: string, agentId: string): Promise<Agent>;
  /** Rotate an agent's public key (AAP §5.9). The private key never leaves the client. */
  rotateAgentKey(hostId: string, agentId: string, publicKeyJwk: Jwk): Promise<Agent>;
  /** Revoke a host (AAP §2.11); cascades to revoke its active/expired agents. */
  revokeHost(hostId: string): Promise<void>;
  /** Rotate a host's public key (AAP §5.10); the host's `iss` thumbprint changes accordingly. */
  rotateHostKey(hostId: string, publicKeyJwk: Jwk): Promise<Host>;
  /** Introspect an agent token (AAP §5.12 / RFC 7662). Never throws on an invalid token: returns active=false. */
  introspect(token: string): Promise<IntrospectionResult>;
}

export function createIdentityService(deps: IdentityServiceDeps): IdentityService {
  const { storage, stateMachine, lifetimes, verifier, issuer } = deps;

  return {
    async registerAgent(hostId, input) {
      const host = await storage.hosts.findById(hostId);
      if (!host) {
        throw new ConduitError(ErrorCode.hostNotFound, 'host not found', 404);
      }
      if (host.status !== 'active') {
        throw new ConduitError(ErrorCode.hostPending, 'host is not active', 403);
      }

      // Create pending, then activate through the state machine and stamp the lifetime clocks.
      // (Registration idempotency + partial capability approval land in Sprint 2.)
      const created = await storage.agents.create({
        hostId,
        publicKeyJwk: input.publicKeyJwk,
        jwksUrl: null,
        name: input.name ?? null,
        description: input.description ?? null,
        mode: input.mode,
        status: 'pending',
      });
      await stateMachine.transitionAgent(created.id, 'active');

      const now = Date.now();
      await storage.agents.applyLifetimes(created.id, {
        activatedAt: new Date(now),
        sessionExpiresAt: new Date(now + lifetimes.sessionTtlSeconds * 1000),
        maxLifetimeExpiresAt: new Date(now + lifetimes.maxLifetimeSeconds * 1000),
        absoluteExpiresAt: new Date(now + lifetimes.absoluteLifetimeSeconds * 1000),
      });

      const activated = await storage.agents.findById(created.id);
      if (!activated) {
        throw new ConduitError(ErrorCode.internalError, 'agent disappeared after activation', 500);
      }
      return activated;
    },

    async getAgentStatus(agentId) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      return agent;
    },

    async revokeAgent(hostId, agentId) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      if (agent.status === 'revoked') {
        return; // idempotent
      }
      await stateMachine.transitionAgent(agentId, 'revoked');
    },

    async updateAgentMetadata(hostId, agentId, name, description) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      await storage.agents.updateMetadata(agentId, name, description);
    },

    async grantCapability(hostId, input) {
      const agent = await storage.agents.findById(input.agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      return storage.capabilityGrants.upsert({
        agentId: input.agentId,
        capability: input.capability,
        connectionId: input.connectionId,
        operation: input.operation,
        status: 'active',
        constraints: input.constraints,
        grantedBy: hostId,
        expiresAt: null,
      });
    },

    async requestCapability(agentId, requests) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      const grants: CapabilityGrant[] = [];
      for (const request of requests) {
        const active = await storage.capabilityGrants.findActive(agentId, request.name);
        if (active) {
          grants.push(active); // already granted — nothing to approve
          continue;
        }
        grants.push(
          await storage.capabilityGrants.upsert({
            agentId,
            capability: request.name,
            connectionId: null,
            operation: null,
            status: 'pending',
            constraints: request.constraints,
            grantedBy: null,
            expiresAt: null,
          }),
        );
      }
      return grants;
    },

    async listGrants(agentId) {
      return storage.capabilityGrants.findForAgent(agentId);
    },

    async reactivateAgent(hostId, agentId) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      if (agent.absoluteExpiresAt && agent.absoluteExpiresAt.getTime() <= Date.now()) {
        throw new ConduitError(
          ErrorCode.invalidRequest,
          'agent has passed its absolute lifetime and cannot be reactivated',
          409,
        );
      }
      await stateMachine.transitionAgent(agentId, 'active');
      const now = Date.now();
      await storage.agents.applyLifetimes(agentId, {
        activatedAt: new Date(now),
        sessionExpiresAt: new Date(now + lifetimes.sessionTtlSeconds * 1000),
        maxLifetimeExpiresAt: new Date(now + lifetimes.maxLifetimeSeconds * 1000),
        absoluteExpiresAt: agent.absoluteExpiresAt, // never reset (AAP §2.5)
      });
      const updated = await storage.agents.findById(agentId);
      if (!updated) {
        throw new ConduitError(ErrorCode.internalError, 'agent disappeared after reactivation', 500);
      }
      return updated;
    },

    async rotateAgentKey(hostId, agentId, publicKeyJwk) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      await storage.agents.updatePublicKey(agentId, publicKeyJwk);
      const updated = await storage.agents.findById(agentId);
      if (!updated) {
        throw new ConduitError(ErrorCode.internalError, 'agent disappeared after key rotation', 500);
      }
      return updated;
    },

    async revokeHost(hostId) {
      const host = await storage.hosts.findById(hostId);
      if (!host) {
        throw new ConduitError(ErrorCode.hostNotFound, 'host not found', 404);
      }
      if (host.status === 'revoked') {
        return; // idempotent
      }
      await stateMachine.transitionHost(hostId, 'revoked');
      // Cascade: no agent of a revoked host may remain usable (AAP §2.11).
      const agents = await storage.agents.listByHost(hostId);
      for (const agent of agents) {
        if (agent.status === 'active' || agent.status === 'expired') {
          await stateMachine.transitionAgent(agent.id, 'revoked');
        }
      }
    },

    async rotateHostKey(hostId, publicKeyJwk) {
      const host = await storage.hosts.findById(hostId);
      if (!host) {
        throw new ConduitError(ErrorCode.hostNotFound, 'host not found', 404);
      }
      await storage.hosts.updatePublicKey(hostId, publicKeyJwk);
      const updated = await storage.hosts.findById(hostId);
      if (!updated) {
        throw new ConduitError(ErrorCode.internalError, 'host disappeared after key rotation', 500);
      }
      return updated;
    },

    async introspect(token) {
      try {
        const decoded = decodeJwt<{
          sub?: string;
          iss?: string;
          aud?: string;
          exp?: number;
          iat?: number;
          jti?: string;
        }>(token);
        const claims = decoded.claims;
        if (decoded.typ !== 'agent+jwt' || !claims.sub) {
          return { active: false };
        }
        const agent = await storage.agents.findById(claims.sub);
        if (!agent || !agent.publicKeyJwk) {
          return { active: false };
        }
        // Verify signature but NOT the jti (introspection is not a use of the token, so it must not
        // trip replay protection). Claims + live state are still checked.
        await verifier.verify(token, agent.publicKeyJwk);
        const nowSec = Math.floor(Date.now() / 1000);
        if (
          claims.aud !== issuer ||
          (typeof claims.exp === 'number' && claims.exp <= nowSec) ||
          agent.status !== 'active' ||
          (agent.sessionExpiresAt !== null && agent.sessionExpiresAt.getTime() <= Date.now())
        ) {
          return { active: false };
        }
        const grants = await storage.capabilityGrants.findForAgent(claims.sub);
        return {
          active: true,
          sub: claims.sub,
          iss: claims.iss,
          aud: claims.aud,
          exp: claims.exp,
          iat: claims.iat,
          jti: claims.jti,
          typ: 'agent+jwt',
          agent_status: agent.status,
          mode: agent.mode,
          capabilities: grants.filter((g) => g.status === 'active').map((g) => g.capability),
        };
      } catch {
        return { active: false };
      }
    },
  };
}
