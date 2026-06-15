import type { AgentJwtClaims, HostJwtClaims, JwtTyp } from '@conduit/core';

/** Signs compact EdDSA JWTs. `node:crypto` only. */
export interface JwtSigner {
  /** Produce a compact JWS with the given `typ` header and claim set. */
  sign(
    typ: JwtTyp,
    claims: HostJwtClaims | AgentJwtClaims,
    privateKeyJwk: Record<string, unknown>,
  ): Promise<string>;
}

/** Build the default EdDSA signer. @remarks Stub. */
export function createJwtSigner(): JwtSigner {
  throw new Error('createJwtSigner not implemented');
}
