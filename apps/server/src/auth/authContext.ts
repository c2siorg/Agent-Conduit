import type { Agent, AgentJwtClaims, Host, HostJwtClaims, JwtTyp } from '@conduit/core';

/**
 * AuthContext — mutable state threaded through the JWT pipeline (Chain of Responsibility).
 * Early stages populate fields later stages depend on. Raw `args` are used for constraint checks
 * and are NEVER logged in raw form.
 */
export interface AuthContext {
  /** Raw compact token from the `Authorization` header. */
  readonly token: string;
  /** Token type the endpoint requires (set by the route). */
  readonly expectedTyp: JwtTyp;
  /** Capability being executed, when applicable (drives stage 5). */
  readonly capability?: string;
  /** Supplied execution args (constraint checking only). */
  readonly args?: Record<string, unknown>;

  // Progressively populated by stages:
  decodedTyp?: JwtTyp;
  claims?: HostJwtClaims | AgentJwtClaims;
  host?: Host;
  agent?: Agent;
}
