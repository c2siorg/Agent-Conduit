import { randomInt } from 'node:crypto';
import type { CapabilityGrant } from '@conduit/core';

/**
 * Serialize a capability grant into the AAP `agent_capability_grants` wire shape (§5.5):
 *   - active  -> full detail (granted_by, constraints, connection mapping)
 *   - pending -> capability + status only
 *   - denied  -> capability + status + human-readable reason
 */
export function serializeGrant(grant: CapabilityGrant): Record<string, unknown> {
  if (grant.status === 'active') {
    return {
      capability: grant.capability,
      status: grant.status,
      granted_by: grant.grantedBy,
      constraints: grant.constraints,
      connection_id: grant.connectionId,
      operation: grant.operation,
    };
  }
  if (grant.status === 'denied') {
    return { capability: grant.capability, status: grant.status, reason: grant.reason };
  }
  return { capability: grant.capability, status: grant.status };
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
const DIGITS = '23456789';

/** Generate a short, human-readable device-authorization user code, e.g. "WXYZ-5678" (RFC 8628 style). */
export function makeUserCode(): string {
  const pick = (set: string, n: number): string =>
    Array.from({ length: n }, () => set[randomInt(set.length)] ?? '').join('');
  return `${pick(LETTERS, 4)}-${pick(DIGITS, 4)}`;
}
