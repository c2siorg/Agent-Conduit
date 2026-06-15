import type { Router } from 'express';
import type { AppDependencies } from '../server/dependencies.js';

/**
 * Identity lifecycle routes (AAP §5.3–§5.10). Each mounts the matching JWT pipeline
 * (`host+jwt` for registration/host ops, `agent+jwt` for agent self-service):
 *   POST /agent/register          (§5.3 — idempotent retry for pending; 409 agent_exists; partial approval)
 *   POST /agent/request-capability (§5.4)
 *   GET  /agent/status            (§5.5)
 *   POST /agent/reactivate        (§5.6)
 *   POST /agent/revoke            (§5.7)
 *   POST /agent/rotate-key        (§5.8)
 *   POST /host/rotate-key         (§5.9)
 *   POST /host/revoke             (§5.10 — returns agents_revoked)
 *   POST /agent/introspect        (§5.12 — RFC 7662, compact grants)
 * @remarks Stub.
 */
export function identityRoutes(_deps: AppDependencies): Router {
  throw new Error('identityRoutes not implemented');
}
