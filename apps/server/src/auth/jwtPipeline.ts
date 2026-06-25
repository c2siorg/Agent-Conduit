import type { AuthContext } from './authContext.js';

/**
 * One stage of the JWT security pipeline.
 * A stage either passes (mutating `ctx`) or THROWS a `ConduitError` to short-circuit the chain.
 */
export interface JwtPipelineStage {
  readonly name: string;
  execute(ctx: AuthContext): Promise<void>;
}

/**
 * JwtPipeline — Chain of Responsibility runner.
 *
 * Stages run in fixed order and are NEVER reordered or skipped — not even on cache hits, because
 * revocation must take effect immediately (a revoked agent must fail the state stage).
 */
export class JwtPipeline {
  constructor(private readonly stages: readonly JwtPipelineStage[]) {}

  /** Ordered stage names — useful for audit/debug. */
  get order(): string[] {
    return this.stages.map((s) => s.name);
  }

  async run(ctx: AuthContext): Promise<void> {
    for (const stage of this.stages) {
      await stage.execute(ctx);
    }
  }
}
