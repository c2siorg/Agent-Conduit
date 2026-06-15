/**
 * CredentialCipher — AES-256-GCM encryption for platform credentials at rest (`node:crypto`).
 *
 * Encryption/decryption happen in the APPLICATION layer; the database stores ONLY ciphertext, so a
 * DB dump never exposes a credential. The key is derived from the configured master key
 * (`crypto.masterKey`). Output packs `iv || authTag || ciphertext`.
 */
export interface CredentialCipher {
  /** Encrypt UTF-8 plaintext → packed ciphertext bytes. */
  encrypt(plaintext: string): Uint8Array;
  /** Decrypt packed ciphertext → UTF-8 plaintext (verifies the GCM auth tag). */
  decrypt(ciphertext: Uint8Array): string;
}

/** Build a cipher bound to a 32-byte master key. @remarks Stub. */
export function createCredentialCipher(_masterKey: Uint8Array): CredentialCipher {
  throw new Error('createCredentialCipher not implemented');
}
