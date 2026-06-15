import type { JwtVerifier } from '@conduit/crypto';
import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 2 signature verify — Ed25519 verification against the stored public key or JWKS URL.
 *
 * Resolves the signer by `iss` (host thumbprint) with FALLBACK to `sub` during the JWKS
 * key-rotation race (AAP §8.7). JWKS URL fetches MUST pass SSRF protection: block private/
 * loopback/link-local ranges, pin the resolved IP (DNS-rebinding), HTTPS-only, redirect/size/timeout caps.
 * @remarks Stub.
 */
export class SignatureVerifyStage implements JwtPipelineStage {
  readonly name = 'signatureVerify';

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly storage: StorageDriver,
  ) {}

  execute(_ctx: AuthContext): Promise<void> {
    throw new Error('SignatureVerifyStage.execute not implemented');
  }
}
