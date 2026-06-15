import type { Router } from 'express';
import type { AppDependencies } from '../server/dependencies.js';

/**
 * Capability routes:
 *   GET  /capability/list      (§5.2 — three auth modes: public / host JWT / agent JWT with grant_status;
 *                               `query` search; cursor pagination next_cursor/has_more)
 *   GET  /capability/describe  (§5.2.1 — full input/output + grant_status; 404 capability_not_found)
 *   POST /capability/request   (§5.4)
 *   POST /capability/execute   (§5.11 — sync `data` / async 202+status_url / SSE; constraint check →
 *                               403 constraint_violated with a violations array)
 * @remarks Stub.
 */
export function capabilityRoutes(_deps: AppDependencies): Router {
  throw new Error('capabilityRoutes not implemented');
}
