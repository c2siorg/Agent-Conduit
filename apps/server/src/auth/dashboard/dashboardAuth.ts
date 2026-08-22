import { randomBytes } from 'node:crypto';
import { ConduitError, ErrorCode } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { CookieOptions, RequestHandler } from 'express';
import type { JwtPipeline } from '../jwtPipeline.js';
import type { AuthContext } from '../authContext.js';
import type { Logger } from '../../observability/logger.js';
import { bearerToken } from '../../server/authMiddleware.js';
import { hashPassword, verifyPassword } from './passwordHash.js';
import { signSession, verifySession } from './session.js';

export const SESSION_COOKIE = 'conduit_session';

export interface DashboardAuthOptions {
  storage: StorageDriver;
  logger: Logger;
  /** Whether login is enabled (usually derived from password presence). */
  enabled: boolean;
  username: string;
  /** Plaintext admin password from env (used only to seed/update the hash; never stored). */
  password: string | undefined;
  /** HMAC secret for session tokens. */
  sessionSecret: string;
  sessionTtlSeconds: number;
  /** Set the cookie Secure flag (true for https deployments). */
  secureCookies: boolean;
}

export interface DashboardAuth {
  readonly enabled: boolean;
  /** Ensure the configured admin account exists and its hash matches the configured password. */
  seedAdminUser(): Promise<void>;
  /** Verify credentials; returns a signed session token, or null if invalid. */
  login(username: string, password: string): Promise<string | null>;
  /** The username of a valid session cookie on this request, or null. */
  sessionUser(req: { headers: { cookie?: string | undefined } }): string | null;
  /** Cookie name + options for the login/logout routes. */
  readonly cookieName: string;
  cookieOptions(): CookieOptions;
  /**
   * Gate middleware for dashboard read endpoints. No-op when disabled. When enabled, allows a valid
   * session cookie OR a valid host+jwt (so operator tooling holding the host key still works), else 401.
   */
  requireSession(hostPipeline: JwtPipeline): RequestHandler;
}

/** Parse a Cookie header into a name→value map (no third-party cookie lib needed). */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    if (name) {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return out;
}

/** Resolve the session secret: the env value if set, else a random per-boot secret (with a warning). */
export function resolveSessionSecret(
  envValue: string | undefined,
  logger: Logger,
): string {
  const trimmed = envValue?.trim();
  if (trimmed) {
    return trimmed;
  }
  logger.warn(
    'dashboard auth: no session secret configured — using a random per-boot secret; sessions will not survive a restart',
  );
  return randomBytes(32).toString('base64');
}

export function createDashboardAuth(opts: DashboardAuthOptions): DashboardAuth {
  const { storage, logger, enabled, username, password, sessionSecret, sessionTtlSeconds } = opts;

  const cookieOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: opts.secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: sessionTtlSeconds * 1000,
  });

  const sessionUser = (req: { headers: { cookie?: string | undefined } }): string | null => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token ? verifySession(token, sessionSecret) : null;
  };

  return {
    enabled,
    cookieName: SESSION_COOKIE,
    cookieOptions,
    sessionUser,

    async seedAdminUser() {
      if (!enabled || !password?.trim()) {
        return;
      }
      const existing = await storage.users.findByUsername(username);
      const hash = await hashPassword(password);
      if (!existing) {
        await storage.users.create({ username, passwordHash: hash });
        logger.info('dashboard auth: created admin user', { username });
        return;
      }
      // Keep the stored hash in sync so the env password is authoritative if it was rotated.
      if (!(await verifyPassword(password, existing.passwordHash))) {
        await storage.users.updatePasswordHash(existing.id, hash);
        logger.info('dashboard auth: updated admin password from configured env', { username });
      }
    },

    async login(user, pass) {
      if (!enabled) {
        return null;
      }
      const record = await storage.users.findByUsername(user);
      // Verify against a decoy hash when the user is unknown so timing does not leak account existence.
      const target = record?.passwordHash ?? DECOY_HASH;
      const ok = await verifyPassword(pass, target);
      if (!record || !ok) {
        return null;
      }
      return signSession(record.username, sessionTtlSeconds, sessionSecret);
    },

    requireSession(hostPipeline) {
      return (req, res, next) => {
        if (!enabled) {
          next();
          return;
        }
        const user = sessionUser(req);
        if (user) {
          res.locals['dashboardUser'] = user;
          next();
          return;
        }
        // Operator escape hatch: a valid host+jwt (CLI / API clients holding the host key).
        const token = bearerToken(req);
        if (token) {
          const ctx: AuthContext = { token, expectedTyp: 'host+jwt' };
          hostPipeline
            .run(ctx)
            .then(() => next())
            .catch(() => next(new ConduitError(ErrorCode.authenticationRequired, 'login required', 401)));
          return;
        }
        next(new ConduitError(ErrorCode.authenticationRequired, 'login required', 401));
      };
    },
  };
}

// A fixed, valid scrypt hash of a random string, used to equalize verify timing for unknown users.
// (Value is irrelevant — it will never match a real password.)
const DECOY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
