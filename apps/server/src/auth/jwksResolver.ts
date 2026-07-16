import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { ConduitError, ErrorCode, type Jwk } from '@conduit/core';
import { isBlockedAddress } from './ipGuard.js';

/**
 * SSRF-hardened JWKS URL resolver (AAP §8.12).
 *
 * When a host/agent is registered with a `jwksUrl` instead of an inline key, the server must fetch it to
 * verify signatures. That fetch is attacker-influenced, so it is locked down:
 *   - HTTPS only; no credentials in the URL.
 *   - DNS is resolved up front and every address is IP-filtered (no loopback/private/link-local/metadata).
 *   - The connection is PINNED to the validated IP (SNI + Host preserved) to defeat DNS rebinding.
 *   - Redirects are refused; response size and time are capped.
 *   - The body must be a valid JWKS of Ed25519 (OKP) keys, count-capped.
 * Results are cached per URL for a short TTL so short-lived agent JWTs don't refetch on every request.
 */
export interface JwksResolver {
  resolve(jwksUrl: string, kid?: string): Promise<Jwk>;
}

export interface JwksResolverOptions {
  /** Allow private/loopback targets — ONLY for dev or trusted internal JWKS. Default false. A function is
   * read live so operator toggles apply without rebuilding the resolver. */
  allowPrivateHosts?: boolean | (() => boolean);
  ttlSeconds?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxKeys?: number;
  now?: () => number;
  /** Resolve a hostname to IP strings (injectable for tests). */
  lookup?: (hostname: string) => Promise<string[]>;
  /** Fetch the body from a PINNED ip (injectable for tests). */
  httpGet?: (target: { ip: string; url: URL; timeoutMs: number; maxBytes: number }) => Promise<string>;
}

const DEFAULTS = { ttlSeconds: 300, timeoutMs: 3000, maxBytes: 100_000, maxKeys: 20 };

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
}

/** Default HTTPS getter: connects to the pinned IP with SNI+Host = hostname, refuses redirects, caps size. */
function defaultHttpGet(target: { ip: string; url: URL; timeoutMs: number; maxBytes: number }): Promise<string> {
  const { ip, url, timeoutMs, maxBytes } = target;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: ip,
        servername: url.hostname, // SNI = real hostname
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: timeoutMs,
        headers: { host: url.host, accept: 'application/json' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy();
          reject(new Error('JWKS fetch: redirects are not allowed'));
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          reject(new Error(`JWKS fetch: unexpected status ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new Error('JWKS fetch: response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    req.on('timeout', () => req.destroy(new Error('JWKS fetch: timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Parse + validate a JWKS body into Ed25519 (OKP) keys. */
export function validateJwks(body: string, maxKeys: number): Jwk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('JWKS is not valid JSON');
  }
  const keys = (parsed as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) {
    throw new Error('JWKS missing "keys" array');
  }
  if (keys.length > maxKeys) {
    throw new Error('JWKS has too many keys');
  }
  const out: Jwk[] = [];
  for (const k of keys as Array<Record<string, unknown>>) {
    if (k['kty'] === 'OKP' && k['crv'] === 'Ed25519' && typeof k['x'] === 'string') {
      out.push({ kty: 'OKP', crv: 'Ed25519', x: k['x'], ...(typeof k['kid'] === 'string' ? { kid: k['kid'] } : {}) } as Jwk);
    }
  }
  if (out.length === 0) {
    throw new Error('JWKS contains no usable Ed25519 keys');
  }
  return out;
}

export function createJwksResolver(options: JwksResolverOptions = {}): JwksResolver {
  const ttlSeconds = options.ttlSeconds ?? DEFAULTS.ttlSeconds;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxKeys = options.maxKeys ?? DEFAULTS.maxKeys;
  const allowPrivateOpt = options.allowPrivateHosts ?? false;
  const allowPrivate = (): boolean => (typeof allowPrivateOpt === 'function' ? allowPrivateOpt() : allowPrivateOpt);
  const now = options.now ?? (() => Date.now());
  const lookup = options.lookup ?? defaultLookup;
  const httpGet = options.httpGet ?? defaultHttpGet;
  const cache = new Map<string, { keys: Jwk[]; expiresAt: number }>();

  async function fetchKeys(jwksUrl: string): Promise<Jwk[]> {
    let url: URL;
    try {
      url = new URL(jwksUrl);
    } catch {
      throw new ConduitError(ErrorCode.invalidRequest, 'jwks_uri is not a valid URL', 400);
    }
    if (url.protocol !== 'https:') {
      throw new ConduitError(ErrorCode.invalidRequest, 'jwks_uri must be https', 400);
    }
    if (url.username || url.password) {
      throw new ConduitError(ErrorCode.invalidRequest, 'jwks_uri must not contain credentials', 400);
    }
    const ips = await lookup(url.hostname);
    if (ips.length === 0) {
      throw new ConduitError(ErrorCode.invalidRequest, 'jwks_uri host did not resolve', 400);
    }
    if (!allowPrivate()) {
      for (const ip of ips) {
        if (isBlockedAddress(ip)) {
          throw new ConduitError(ErrorCode.invalidRequest, 'jwks_uri resolves to a blocked address', 400);
        }
      }
    }
    const pinned = ips[0] as string; // pin to a validated address (defeats rebinding)
    const body = await httpGet({ ip: pinned, url, timeoutMs, maxBytes });
    return validateJwks(body, maxKeys);
  }

  return {
    async resolve(jwksUrl, kid) {
      const cached = cache.get(jwksUrl);
      let keys: Jwk[];
      if (cached && cached.expiresAt > now()) {
        keys = cached.keys;
      } else {
        keys = await fetchKeys(jwksUrl);
        cache.set(jwksUrl, { keys, expiresAt: now() + ttlSeconds * 1000 });
      }
      const key = kid ? keys.find((k) => (k as { kid?: string }).kid === kid) : keys[0];
      if (!key) {
        throw new ConduitError(ErrorCode.invalidJwt, 'no matching key in JWKS', 401);
      }
      return key;
    },
  };
}
