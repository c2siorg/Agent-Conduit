import { ConduitError, ErrorCode } from '@conduit/core';
import { Router } from 'express';
import type { DashboardAuth } from '../auth/dashboard/dashboardAuth.js';

export interface AuthRoutesDeps {
  auth: DashboardAuth;
}

/**
 * Dashboard login routes (Conduit extension — not AAP). On success the session token is set as a
 * Secure, httpOnly, SameSite=Strict cookie; it is never exposed to JavaScript. When login is disabled
 * (no admin password configured) `/auth/session` reports `required: false` so the UI stays open.
 */
export function authRoutes(deps: AuthRoutesDeps): Router {
  const router = Router();
  const { auth } = deps;

  // Tells the SPA whether to show a login screen and who (if anyone) is signed in.
  router.get('/auth/session', (req, res) => {
    if (!auth.enabled) {
      res.json({ required: false, authenticated: true, username: null });
      return;
    }
    const user = auth.sessionUser(req);
    res.json({ required: true, authenticated: Boolean(user), username: user });
  });

  router.post('/auth/login', (req, res, next) => {
    if (!auth.enabled) {
      // Nothing to log into; report success so the client proceeds.
      res.json({ authenticated: true, username: null });
      return;
    }
    const body = (req.body ?? {}) as { username?: string; password?: string };
    if (!body.username || !body.password) {
      next(new ConduitError(ErrorCode.invalidRequest, 'username and password are required', 400));
      return;
    }
    auth
      .login(body.username, body.password)
      .then((token) => {
        if (!token) {
          // Uniform message — do not reveal whether the username or the password was wrong.
          next(new ConduitError(ErrorCode.authenticationRequired, 'invalid username or password', 401));
          return;
        }
        res.cookie(auth.cookieName, token, auth.cookieOptions());
        res.json({ authenticated: true, username: body.username });
      })
      .catch(next);
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(auth.cookieName, { ...auth.cookieOptions(), maxAge: undefined });
    res.json({ authenticated: false });
  });

  return router;
}
