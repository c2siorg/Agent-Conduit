/**
 * JWT `typ` header values — bound per endpoint to prevent token confusion (AAP §4, pipeline stage 1).
 */
export type JwtTyp = 'host+jwt' | 'agent+jwt';

/**
 * Registered + AAP claims common to both token types.
 * Wire claim names follow the JWT/AAP spec (abbreviated) — they are protocol constants, NOT camelCase.
 */
interface BaseJwtClaims {
  /** RFC 7638 SHA-256 JWK thumbprint of the signing key. */
  iss: string;
  /** Issuer, or the resolved capability `location` for execute. */
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Host JWT (`typ: host+jwt`, AAP §4.2). Registration payloads carry agent key material (endpoint layer). */
export interface HostJwtClaims extends BaseJwtClaims {
  cnf?: ConfirmationClaim;
}

/** Agent JWT (`typ: agent+jwt`, ≤60s, AAP §4.3). */
export interface AgentJwtClaims extends BaseJwtClaims {
  /** Agent id. */
  sub: string;
  /** Optional JWT-level capability restriction — intersected with grants at verification step 11. */
  capabilities?: string[];
  cnf?: ConfirmationClaim;
}

/** Sender-constraint confirmation — opt-in (DPoP `jkt` / mTLS `x5t#S256`). */
export interface ConfirmationClaim {
  /** DPoP key thumbprint (RFC 9449). */
  jkt?: string;
  /** mTLS client-cert thumbprint (RFC 8705). */
  'x5t#S256'?: string;
}
