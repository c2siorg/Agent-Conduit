import { ConduitError, ErrorCode } from '@conduit/core';
import type { AgentJwtClaims, HostJwtClaims, Jwk } from '@conduit/core';
import { decodeJwt, type JwtVerifier } from '@conduit/crypto';
import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';
import type { JwksResolver } from '../jwksResolver.js';

/**
 * 2. signature verify — Ed25519 verification against the principal's public key.
 *
 * Resolves the signer from the (unverified) claims: agent JWTs by `sub` (agent id), host JWTs by
 * `iss` (host thumbprint). The key is the inline JWK if present, otherwise fetched from the principal's
 * `jwksUrl` via the SSRF-hardened resolver (AAP §8.12).
 */
export class SignatureVerifyStage implements JwtPipelineStage {
  readonly name = 'signatureVerify';

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly storage: StorageDriver,
    private readonly jwksResolver?: JwksResolver,
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
      const key = await this.resolveKey(agent.publicKeyJwk, agent.jwksUrl, (decoded.header as { kid?: string }).kid, 'agent');
      await this.verifyWith(ctx.token, key);
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
    const key = await this.resolveKey(host.publicKeyJwk, host.jwksUrl, (decoded.header as { kid?: string }).kid, 'host');
    await this.verifyWith(ctx.token, key);
    ctx.host = host;
    ctx.claims = decoded.claims;
  }

  /** Inline key wins; otherwise fetch from jwksUrl through the SSRF-hardened resolver. */
  private async resolveKey(
    inlineKey: Jwk | null,
    jwksUrl: string | null,
    kid: string | undefined,
    who: string,
  ): Promise<Jwk> {
    if (inlineKey) {
      return inlineKey;
    }
    if (jwksUrl && this.jwksResolver) {
      return this.jwksResolver.resolve(jwksUrl, kid);
    }
    throw new ConduitError(ErrorCode.invalidJwt, `${who} has no verifiable key`, 401);
  }

  private async verifyWith(token: string, publicKeyJwk: Jwk): Promise<void> {
    try {
      await this.verifier.verify(token, publicKeyJwk);
    } catch {
      throw new ConduitError(ErrorCode.invalidJwt, 'signature verification failed', 401);
    }
  }
}
