import { ConduitError, ErrorCode } from '@conduit/core';
import type { Request, RequestHandler } from 'express';

/** Match a client IP against an entry: exact string, or an IPv4 CIDR (a.b.c.d/n). */
function matchesEntry(ip: string, entry: string): boolean {
  if (ip === entry) {
    return true;
  }
  const slash = entry.indexOf('/');
  if (slash === -1) {
    return false;
  }
  const base = entry.slice(0, slash);
  const bits = Number(entry.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const toInt = (s: string): number | null => {
    const parts = s.split('.');
    if (parts.length !== 4) {
      return null;
    }
    let v = 0;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) {
        return null;
      }
      v = v * 256 + n;
    }
    return v >>> 0;
  };
  const ipInt = toInt(ip);
  const baseInt = toInt(base);
  if (ipInt === null || baseInt === null) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Client-IP allow/deny middleware. `allow` mode admits only listed IPs/CIDRs; `deny` mode blocks listed
 * ones. Enforced only when enabled with a non-empty list (an empty allow-list would lock everyone out,
 * so it is treated as "no filter"). Reads its config LIVE so dashboard toggles apply immediately.
 */
export function ipFilter(
  getConfig: () => { enabled: boolean; mode: 'allow' | 'deny'; entries: string[] },
  keyFn: (req: Request) => string,
): RequestHandler {
  return (req, res, next) => {
    const cfg = getConfig();
    if (!cfg.enabled || cfg.entries.length === 0) {
      next();
      return;
    }
    const ip = keyFn(req);
    const listed = cfg.entries.some((e) => matchesEntry(ip, e));
    const blocked = cfg.mode === 'allow' ? !listed : listed;
    if (blocked) {
      next(new ConduitError(ErrorCode.unauthorized, 'client IP is not permitted', 403));
      return;
    }
    next();
  };
}
