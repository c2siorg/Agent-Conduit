import type { Router } from 'express';
import type { AppDependencies } from '../server/dependencies.js';

/**
 * Token Router routes (agent JWT required):
 *   GET /tools/:name — identity-scoped schema serving. If the capability is not granted → 403 and the
 *                      agent never sees the schema. Otherwise: resolve adapter → normalize → return → log.
 * @remarks Stub.
 */
export function toolRoutes(_deps: AppDependencies): Router {
  throw new Error('toolRoutes not implemented');
}
