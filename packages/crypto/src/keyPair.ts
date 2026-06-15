import type { Jwk } from '@conduit/core';

/**
 * A freshly generated Ed25519 keypair.
 * The PRIVATE JWK is returned to the caller and is NEVER persisted server-side.
 */
export interface GeneratedKeyPair {
  publicKeyJwk: Jwk;
  privateKeyJwk: Jwk & { d: string };
}

/**
 * Generate an Ed25519 keypair using `node:crypto` ONLY (no third-party crypto libs).
 * @remarks Stub — will wrap `crypto.generateKeyPair('ed25519', …)` and export JWKs.
 */
export function generateEd25519KeyPair(): GeneratedKeyPair {
  throw new Error('generateEd25519KeyPair not implemented');
}
