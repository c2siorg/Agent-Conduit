import { createPublicKey, verify as edVerify } from 'node:crypto';
import type { Jwk, JwtTyp } from '@conduit/core';

/** A decoded-but-unverified JWT, used to resolve the signing key before verification. */
export interface DecodedJwt<TClaims> {
  typ: JwtTyp;
  header: { alg?: string; typ?: JwtTyp };
  claims: TClaims;
  signingInput: string;
  signature: Buffer;
}

/** A verified JWT — decoded header `typ` + typed claims. */
export interface VerifiedJwt<TClaims> {
  typ: JwtTyp;
  claims: TClaims;
}

/**
 * Decode a compact JWT WITHOUT verifying its signature.
 * Used only to read `iss`/`sub`/`typ` so the correct public key can be resolved (then verify).
 */
export function decodeJwt<TClaims = Record<string, unknown>>(token: string): DecodedJwt<TClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed JWT: expected three segments');
  }
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; typ?: JwtTyp };
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as TClaims;
  return {
    typ: header.typ as JwtTyp,
    header,
    claims,
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, 'base64url'),
  };
}

/** Verifies compact EdDSA JWT signatures against an Ed25519 public JWK. */
export interface JwtVerifier {
  /** Verify signature + decode. Does NOT enforce claims/state — that is the pipeline's job. */
  verify<TClaims>(token: string, publicKeyJwk: Jwk): Promise<VerifiedJwt<TClaims>>;
}

/** Build the default EdDSA verifier. */
export function createJwtVerifier(): JwtVerifier {
  return {
    // async so a verification failure becomes a rejected promise, not a synchronous throw.
    async verify<TClaims>(token: string, publicKeyJwk: Jwk): Promise<VerifiedJwt<TClaims>> {
      const decoded = decodeJwt<TClaims>(token);
      const key = createPublicKey({ key: publicKeyJwk as never, format: 'jwk' });
      const ok = edVerify(null, Buffer.from(decoded.signingInput, 'utf8'), key, decoded.signature);
      if (!ok) {
        throw new Error('invalid JWT signature');
      }
      return { typ: decoded.typ, claims: decoded.claims };
    },
  };
}
