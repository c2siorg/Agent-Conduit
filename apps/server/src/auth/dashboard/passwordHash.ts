import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for dashboard operator accounts.
 *
 * Uses scrypt from `node:crypto` — a memory-hard KDF — so we add NO third-party crypto dependency
 * (per the repo's hard constraint). Each hash is self-describing so parameters can evolve without a
 * migration: `scrypt$N$r$p$<saltB64>$<hashB64>`. Verification is constant-time.
 */

// Cost parameters. N must be a power of two; these give a ~100ms hash on commodity hardware in 2026.
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/** Promise wrapper around scrypt WITH cost options (util.promisify can't see the options overload). */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) {
        reject(err);
      } else {
        resolve(derived);
      }
    });
  });
}

/** Hash a plaintext password into a self-describing, storable string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Constant-time verify of a plaintext password against a stored hash. Returns false on any malformed hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64 ?? '', 'base64');
    expected = Buffer.from(hashB64 ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = await scryptAsync(password, salt, expected.length, { N: n, r, p });
  // Lengths match by construction (derived to expected.length), so timingSafeEqual is safe to call.
  return timingSafeEqual(derived, expected);
}
