import { createPrivateKey, sign as edSign } from 'node:crypto';
import type { AgentJwtClaims, HostJwtClaims, JwtTyp } from '@conduit/core';

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Signs compact EdDSA JWTs. `node:crypto` only. */
export interface JwtSigner {
  /** Produce a compact JWS with the given `typ` header and claim set. */
  sign(
    typ: JwtTyp,
    claims: HostJwtClaims | AgentJwtClaims,
    privateKeyJwk: Record<string, unknown>,
  ): Promise<string>;
}

/** Build the default EdDSA signer. */
export function createJwtSigner(): JwtSigner {
  return {
    // async so a bad-key throw surfaces as a rejected promise.
    async sign(typ, claims, privateKeyJwk) {
      const header = { alg: 'EdDSA', typ };
      const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
      // Ed25519 uses a null algorithm identifier with crypto.sign.
      const key = createPrivateKey({ key: privateKeyJwk as never, format: 'jwk' });
      const signature = edSign(null, Buffer.from(signingInput, 'utf8'), key);
      return `${signingInput}.${signature.toString('base64url')}`;
    },
  };
}
