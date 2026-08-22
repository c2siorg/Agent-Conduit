import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless dashboard session tokens: `<payloadB64url>.<hmacB64url>`.
 *
 * The payload is a JSON `{ sub, exp }` (username + expiry epoch seconds); the signature is
 * HMAC-SHA256 over the payload with a server-side secret. No server-side session store is needed —
 * revocation is by expiry (short TTL) or by rotating the secret. This is separate from the AAP
 * Ed25519 JWTs (which authenticate machine identities); this token authenticates a browser session.
 */

interface SessionPayload {
  sub: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Mint a signed session token for `username`, valid for `ttlSeconds`. */
export function signSession(username: string, ttlSeconds: number, secret: string): string {
  const payload: SessionPayload = { sub: username, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

/** Verify a session token's signature + expiry. Returns the username, or null if invalid/expired. */
export function verifySession(token: string, secret: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload.sub;
}
