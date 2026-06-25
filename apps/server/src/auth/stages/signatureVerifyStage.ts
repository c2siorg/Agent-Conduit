import { ConduitError, ErrorCode } from '@conduit/core';
import type { AgentJwtClaims, HostJwtClaims } from '@conduit/core';
import { decodeJwt, type JwtVerifier } from '@conduit/crypto';
import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 2. signature verify — Ed25519 verification against the principal's stored public key.
 *
 * Resolves the signer from the (unverified) claims: agent JWTs by `sub` (agent id), host JWTs by
 * `iss` (host thumbprint). Inline JWK only for now; JWKS-URL fetch + SSRF protection is a later sprint.
 */
export class SignatureVerifyStage implements JwtPipelineStage {
  readonly name = 'signatureVerify';

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly storage: StorageDriver,
  ) {}

  async execute(ctx: AuthContext): Promise<void> {
    const decoded = decodeJwt<AgentJwtClaims & HostJwtClaims>(ctx.token);

    if (ctx.expectedTyp === 'agent+jwt') {
      const sub = decoded.claims.sub;
      if (!sub) {
        throw new ConduitError(ErrorCode.invalidJwt, 'agent JWT missing sub', 401);
      }
      const agent = await this.storage.agents.findBySubject(sub);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 401);
      }
      await this.verifyWith(ctx.token, agent.publicKeyJwk, 'agent');
      ctx.agent = agent;
      const host = await this.storage.hosts.findById(agent.hostId);
      if (host) {
        ctx.host = host;
      }
      ctx.claims = decoded.claims;
      return;
    }

    // host+jwt
    const iss = decoded.claims.iss;
    if (!iss) {
      throw new ConduitError(ErrorCode.invalidJwt, 'host JWT missing iss', 401);
    }
    const host = await this.storage.hosts.findByThumbprint(iss);
    if (!host) {
      throw new ConduitError(ErrorCode.hostNotFound, 'host not found', 401);
    }
    await this.verifyWith(ctx.token, host.publicKeyJwk, 'host');
    ctx.host = host;
    ctx.claims = decoded.claims;
  }

  private async verifyWith(
    token: string,
    publicKeyJwk: { kty: 'OKP'; crv: 'Ed25519'; x: string } | null,
    who: string,
  ): Promise<void> {
    if (!publicKeyJwk) {
      throw new ConduitError(ErrorCode.invalidJwt, `${who} has no inline key (JWKS not supported yet)`, 401);
    }
    try {
      await this.verifier.verify(token, publicKeyJwk);
    } catch {
      throw new ConduitError(ErrorCode.invalidJwt, 'signature verification failed', 401);
    }
  }
}
