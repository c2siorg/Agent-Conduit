import { generateKeyPairSync } from 'node:crypto';
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
 * Exports both halves as JWKs (OKP / Ed25519).
 */
export function generateEd25519KeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyJwk = publicKey.export({ format: 'jwk' }) as unknown as Jwk;
  const privateKeyJwk = privateKey.export({ format: 'jwk' }) as unknown as Jwk & { d: string };
  return { publicKeyJwk, privateKeyJwk };
}
