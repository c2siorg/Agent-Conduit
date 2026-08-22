import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../../apps/server/src/auth/dashboard/passwordHash.ts';
import { signSession, verifySession } from '../../apps/server/src/auth/dashboard/session.ts';

describe('dashboard password hashing (scrypt, node:crypto only)', () => {
  it('hashes then verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^scrypt\$16384\$8\$1\$/); // self-describing params
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('s3cret');
    assert.equal(await verifyPassword('S3cret', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  it('produces a distinct hash each time (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('same', a), true);
    assert.equal(await verifyPassword('same', b), true);
  });

  it('returns false (never throws) on a malformed stored hash', async () => {
    assert.equal(await verifyPassword('x', 'not-a-hash'), false);
    assert.equal(await verifyPassword('x', 'scrypt$16384$8$1$only-four-parts'), false);
    assert.equal(await verifyPassword('x', ''), false);
  });
});

describe('dashboard session tokens (HMAC)', () => {
  const secret = 'test-session-secret';

  it('signs then verifies, returning the subject', () => {
    const token = signSession('admin', 3600, secret);
    assert.equal(verifySession(token, secret), 'admin');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession('admin', 3600, secret);
    assert.equal(verifySession(token, 'other-secret'), null);
  });

  it('rejects a tampered payload', () => {
    const token = signSession('admin', 3600, secret);
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ sub: 'root', exp: 9999999999 })).toString('base64url')}.${sig}`;
    assert.equal(verifySession(forged, secret), null);
  });

  it('rejects an expired token', () => {
    const token = signSession('admin', -1, secret);
    assert.equal(verifySession(token, secret), null);
  });

  it('rejects garbage', () => {
    assert.equal(verifySession('garbage', secret), null);
    assert.equal(verifySession('', secret), null);
  });
});
