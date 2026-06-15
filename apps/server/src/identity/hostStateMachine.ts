import type { HostState } from '@conduit/core';

/**
 * Allowed HOST state transitions (AAP §2.11).
 * Revoking/rejecting a host MUST cascade to its agents (handled by the IdentityService).
 */
export const HOST_TRANSITIONS: Readonly<Record<HostState, readonly HostState[]>> = {
  pending: ['active', 'rejected'],
  active: ['revoked'],
  revoked: [], // terminal
  rejected: [], // terminal
};

/** Pure predicate: is `from → to` a legal host transition? */
export function canTransitionHost(from: HostState, to: HostState): boolean {
  return HOST_TRANSITIONS[from].includes(to);
}
