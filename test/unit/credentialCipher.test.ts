import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { createCredentialCipher, resolveMasterKey } from '../../apps/server/src/connections/credentialCipher.ts';

const key = randomBytes(32);
const cipher = createCredentialCipher(key);

describe('credential cipher (AES-256-GCM)', () => {
  it('round-trips a credential', () => {
    const secret = 'xoxb-super-secret-slack-token';
    const ct = cipher.encrypt(secret);
    assert.equal(cipher.decrypt(ct), secret);
  });

  it('ciphertext does not contain the plaintext (DB-dump safety)', () => {
    const secret = 'ghp_aGitHubTokenValue';
    const ct = Buffer.from(cipher.encrypt(secret));
    assert.ok(!ct.toString('utf8').includes('ghp_'));
    assert.ok(!ct.toString('latin1').includes(secret));
  });

  it('produces a fresh IV each time (different ciphertext for same input)', () => {
    const a = Buffer.from(cipher.encrypt('same')).toString('hex');
    const b = Buffer.from(cipher.encrypt('same')).toString('hex');
    assert.notEqual(a, b);
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const ct = Buffer.from(cipher.encrypt('secret'));
    ct[ct.length - 1] ^= 0x01; // flip a bit in the ciphertext
    assert.throws(() => cipher.decrypt(ct));
  });

  it('rejects decryption with a different key', () => {
    const ct = cipher.encrypt('secret');
    const other = createCredentialCipher(randomBytes(32));
    assert.throws(() => other.decrypt(ct));
  });

  it('requires a 32-byte key', () => {
    assert.throws(() => createCredentialCipher(randomBytes(16)));
  });

  it('resolveMasterKey accepts base64 32 bytes and rejects wrong sizes', () => {
    const good = randomBytes(32).toString('base64');
    assert.equal(resolveMasterKey('K', { K: good }).length, 32);
    assert.throws(() => resolveMasterKey('K', { K: randomBytes(10).toString('base64') }));
    // dev fallback when unset:
    assert.equal(resolveMasterKey('K', {}).length, 32);
  });
});
