import type { Jwk, JwtTyp } from '@conduit/core';

/** A verified JWT — decoded header `typ` + typed claims. */
export interface VerifiedJwt<TClaims> {
  typ: JwtTyp;
  claims: TClaims;
}

/** Verifies compact EdDSA JWT signatures against an Ed25519 public JWK. */
export interface JwtVerifier {
  /** Verify signature + decode. Does NOT enforce claims/state — that is the pipeline's job. */
  verify<TClaims>(token: string, publicKeyJwk: Jwk): Promise<VerifiedJwt<TClaims>>;
}

/** Build the default EdDSA verifier. @remarks Stub. */
export function createJwtVerifier(): JwtVerifier {
  throw new Error('createJwtVerifier not implemented');
}
