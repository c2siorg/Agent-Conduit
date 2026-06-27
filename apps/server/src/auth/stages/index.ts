import type { JwtVerifier } from '@conduit/crypto';
import type { StorageDriver } from '@conduit/storage';
import type { ConstraintEngine } from '../../identity/constraintEngine.js';
import { JwtPipeline } from '../jwtPipeline.js';
import { CapabilityConstraintStage } from './capabilityConstraintStage.js';
import { ClaimValidationStage } from './claimValidationStage.js';
import type { PipelineConfig } from './pipelineConfig.js';
import { SignatureVerifyStage } from './signatureVerifyStage.js';
import { StateCheckStage } from './stateCheckStage.js';
import { TypCheckStage } from './typCheckStage.js';

export type { PipelineConfig } from './pipelineConfig.js';

/** Dependencies the pipeline stages need (constructor-injected). */
export interface PipelineDeps {
  verifier: JwtVerifier;
  storage: StorageDriver;
  constraintEngine: ConstraintEngine;
  config: PipelineConfig;
}

/**
 * Canonical AGENT pipeline — stages 1..5, in fixed order. The order is the contract and must not change.
 */
export function buildAgentPipeline(deps: PipelineDeps): JwtPipeline {
  return new JwtPipeline([
    new TypCheckStage(),
    new SignatureVerifyStage(deps.verifier, deps.storage),
    new ClaimValidationStage(deps.storage, deps.config),
    new StateCheckStage(deps.storage),
    new CapabilityConstraintStage(deps.constraintEngine, deps.storage),
  ]);
}

/** HOST pipeline — typ -> signature -> claims -> state (no capability stage). */
export function buildHostPipeline(deps: PipelineDeps): JwtPipeline {
  return new JwtPipeline([
    new TypCheckStage(),
    new SignatureVerifyStage(deps.verifier, deps.storage),
    new ClaimValidationStage(deps.storage, deps.config),
    new StateCheckStage(deps.storage),
  ]);
}
