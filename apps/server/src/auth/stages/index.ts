import type { JwtVerifier } from '@conduit/crypto';
import type { StorageDriver } from '@conduit/storage';
import type { ConstraintEngine } from '../../identity/constraintEngine.js';
import { JwtPipeline } from '../jwtPipeline.js';
import { TypCheckStage } from './typCheckStage.js';
import { SignatureVerifyStage } from './signatureVerifyStage.js';
import { ClaimValidationStage } from './claimValidationStage.js';
import { StateCheckStage } from './stateCheckStage.js';
import { CapabilityConstraintStage } from './capabilityConstraintStage.js';

/** Dependencies the pipeline stages need (constructor-injected). */
export interface PipelineDeps {
  verifier: JwtVerifier;
  storage: StorageDriver;
  constraintEngine: ConstraintEngine;
}

/**
 * Canonical AGENT pipeline — stages 1→5, in fixed order. This wiring is the contract:
 * the order is intentional and must never change. (Construction is real; stage bodies are stubs.)
 */
export function buildAgentPipeline(deps: PipelineDeps): JwtPipeline {
  return new JwtPipeline([
    new TypCheckStage(),
    new SignatureVerifyStage(deps.verifier, deps.storage),
    new ClaimValidationStage(deps.storage),
    new StateCheckStage(deps.storage),
    new CapabilityConstraintStage(deps.constraintEngine, deps.storage),
  ]);
}

/** HOST pipeline — typ → signature → claims → state (no capability stage). */
export function buildHostPipeline(deps: PipelineDeps): JwtPipeline {
  return new JwtPipeline([
    new TypCheckStage(),
    new SignatureVerifyStage(deps.verifier, deps.storage),
    new ClaimValidationStage(deps.storage),
    new StateCheckStage(deps.storage),
  ]);
}
