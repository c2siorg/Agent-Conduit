/**
 * JSON Web Key (subset) — Ed25519 public keys only (RFC 8037 OKP/Ed25519, RFC 7638 thumbprints).
 * Conduit stores PUBLIC keys exclusively; private keys never leave the client.
 */
export interface Jwk {
  /** Octet Key Pair. */
  kty: 'OKP';
  /** Edwards curve. */
  crv: 'Ed25519';
  /** base64url-encoded public key. */
  x: string;
  /** Key id — REQUIRED when delivered via a JWKS URL. */
  kid?: string;
  use?: 'sig';
  alg?: 'EdDSA';
}

/** A JWK Set, as served at a JWKS URL or `/.well-known/jwks.json`. */
export interface JwkSet {
  keys: Jwk[];
}

/**
 * How a principal's key is delivered. FIXED at registration — a host/agent registered
 * `inline` MUST NOT later present a `jwksUrl` and vice versa (AAP §8.7).
 */
export type KeyDeliveryMode = 'inline' | 'jwksUrl';
