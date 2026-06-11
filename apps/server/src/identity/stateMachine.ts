import { ConduitError, ErrorCode } from '@conduit/core';
import type { Agent, AgentState, Host, HostState } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import { canTransitionAgent } from './agentStateMachine.js';
import { canTransitionHost } from './hostStateMachine.js';

/**
 * StateMachine — the SINGLE sanctioned path for status changes (AAP §2.3 / §2.11).
 *
 * Each transition runs atomically: load the current state, validate it against the transition table,
 * then persist. Repositories' `updateStatus` is the low-level primitive and must only ever be called
 * from here, so an illegal or unrecorded transition cannot happen.
 *
 * Note: cascades (host revoke -> revoke its agents) and reactivation-clock rules live in the
 * IdentityService, which composes this primitive.
 */
export interface StateMachine {
  transitionAgent(agentId: string, to: AgentState): Promise<Agent>;
  transitionHost(hostId: string, to: HostState): Promise<Host>;
}

export function createStateMachine(storage: StorageDriver): StateMachine {
  return {
    transitionAgent(agentId, to) {
      return storage.transaction(async (tx) => {
        const agent = await tx.agents.findById(agentId);
        if (!agent) {
          throw new ConduitError(ErrorCode.agentNotFound, `agent ${agentId} not found`, 404);
        }
        if (!canTransitionAgent(agent.status, to)) {
          throw new ConduitError(
            ErrorCode.invalidRequest,
            `illegal agent transition: ${agent.status} -> ${to}`,
            409,
          );
        }
        await tx.agents.updateStatus(agentId, to);
        const updated = await tx.agents.findById(agentId);
        if (!updated) {
          throw new ConduitError(ErrorCode.internalError, 'agent disappeared mid-transition', 500);
        }
        return updated;
      });
    },

    transitionHost(hostId, to) {
      return storage.transaction(async (tx) => {
        const host = await tx.hosts.findById(hostId);
        if (!host) {
          throw new ConduitError(ErrorCode.hostNotFound, `host ${hostId} not found`, 404);
        }
        if (!canTransitionHost(host.status, to)) {
          throw new ConduitError(
            ErrorCode.invalidRequest,
            `illegal host transition: ${host.status} -> ${to}`,
            409,
          );
        }
        await tx.hosts.updateStatus(hostId, to);
        const updated = await tx.hosts.findById(hostId);
        if (!updated) {
          throw new ConduitError(ErrorCode.internalError, 'host disappeared mid-transition', 500);
        }
        return updated;
      });
    },
  };
}
