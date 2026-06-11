import type { Jwk } from './jwk.js';

/**
 * Agent lifecycle states (AAP §2.3) — SIX states.
 * The state machine is authoritative; route every transition through it (never mutate `status` directly).
 */
export type AgentState =
  | 'pending' // registered, awaiting host/user approval
  | 'active' // approved and within all lifetime clocks
  | 'expired' // a lifetime clock elapsed; reactivatable unless absolute elapsed
  | 'revoked' // permanently terminated
  | 'rejected' // user denied registration (terminal)
  | 'claimed'; // autonomous agent claimed when its host was linked (terminal)

/** Host lifecycle states (AAP §2.11). */
export type HostState = 'active' | 'pending' | 'revoked' | 'rejected';

/** Agent operating mode — IMMUTABLE after creation (AAP §2.2). */
export type AgentMode = 'delegated' | 'autonomous';

/**
 * Host — persistent identity of a client environment (app instance, CI runner, device).
 * Owns an Ed25519 keypair, an optional user linkage, and a default capability set.
 */
export interface Host {
  id: string;
  /** Inline public key (mutually exclusive with `jwksUrl`). */
  publicKeyJwk: Jwk | null;
  /** JWKS-URL key delivery (mutually exclusive with `publicKeyJwk`). */
  jwksUrl: string | null;
  /** Linked end-user, set via host linking (AAP §2.9); null when unlinked. */
  userId: string | null;
  /** Capabilities inherited by agents on registration / reactivation. */
  defaultCapabilities: string[];
  status: HostState;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Agent — per-session runtime actor registered under a host.
 * Own keypair, own grants; authenticates with short-lived signed JWTs.
 */
export interface Agent {
  id: string;
  hostId: string;
  publicKeyJwk: Jwk | null;
  jwksUrl: string | null;
  status: AgentState;
  /** Immutable after creation. */
  mode: AgentMode;
  activatedAt: Date | null;

  // THREE independent lifetime clocks (AAP §2.4).
  /** Session TTL — slides forward on every request. */
  sessionExpiresAt: Date | null;
  /** Max lifetime — measured from last activation. */
  maxLifetimeExpiresAt: Date | null;
  /** Absolute lifetime — from creation; on elapse → permanent `revoked`. */
  absoluteExpiresAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
