import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * CredentialCipher — AES-256-GCM encryption for platform credentials at rest (`node:crypto`).
 *
 * Encryption/decryption happen in the APPLICATION layer; the database stores ONLY ciphertext, so a DB
 * dump never exposes a credential. Output packs `iv(12) || authTag(16) || ciphertext`. The 32-byte key
 * is derived from the configured master key.
 */
export interface CredentialCipher {
  encrypt(plaintext: string): Uint8Array;
  decrypt(ciphertext: Uint8Array): string;
}

const IV_LEN = 12;
const TAG_LEN = 16;

export function createCredentialCipher(masterKey: Uint8Array): CredentialCipher {
  if (masterKey.length !== 32) {
    throw new Error('credential cipher master key must be 32 bytes (AES-256)');
  }
  const key = Buffer.from(masterKey);
  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), enc]);
    },
    decrypt(ciphertext) {
      const buf = Buffer.from(ciphertext);
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const enc = buf.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * Resolve the 32-byte master key. A base64 32-byte value in `env[varName]` is used directly; otherwise a
 * deterministic DEV key is derived (with no secret configured) so local/dev works out of the box.
 * Production MUST set a real key.
 */
export function resolveMasterKey(varName: string, env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const raw = env[varName];
  if (raw && raw.trim()) {
    const decoded = Buffer.from(raw.trim(), 'base64');
    if (decoded.length !== 32) {
      throw new Error(`${varName} must be base64-encoded 32 bytes (got ${decoded.length})`);
    }
    return decoded;
  }
  // Dev fallback: derive a stable 32-byte key so credentials survive restarts locally.
  return createHash('sha256').update('conduit-dev-master-key-do-not-use-in-production').digest();
}
