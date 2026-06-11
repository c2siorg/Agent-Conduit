import type { AgentState } from '@conduit/core';

/**
 * Allowed AGENT state transitions (AAP §2.3). This table is AUTHORITATIVE — every status change
 * routes through the StateMachine (identity/stateMachine.ts), which validates against this table
 * before persisting; code never mutates `status` directly. Terminal states have no exits.
 */
export const AGENT_TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = {
  pending: ['active', 'rejected'],
  active: ['expired', 'revoked', 'claimed'],
  expired: ['active', 'revoked'], // reactivation — fails if the absolute clock has elapsed
  revoked: [], // terminal
  rejected: [], // terminal
  claimed: [], // terminal
};

/** Pure predicate: is `from -> to` a legal agent transition? */
export function canTransitionAgent(from: AgentState, to: AgentState): boolean {
  return AGENT_TRANSITIONS[from].includes(to);
}
