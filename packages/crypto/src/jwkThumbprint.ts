import { createHash } from 'node:crypto';
import type { Jwk } from '@conduit/core';

/**
 * RFC 7638 JWK Thumbprint — SHA-256 over the canonical JWK, base64url-encoded (no padding).
 * Used as the host/agent `iss` and for dynamic-registration identity binding (AAP §4.5.1 step 4).
 *
 * Per RFC 7638 §3, the hash input is the JWK's REQUIRED members only, with no whitespace and keys in
 * lexicographic order. For an OKP key (RFC 8037 §2) those members are `crv`, `kty`, `x` — already sorted.
 * node:crypto only; no third-party crypto.
 */
export function jwkThumbprint(jwk: Jwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return createHash('sha256').update(canonical, 'utf8').digest('base64url');
}
