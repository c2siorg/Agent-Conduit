import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { createJwtSigner } from '../../packages/crypto/src/jwtSigner.ts';
import { createJwtVerifier, decodeJwt } from '../../packages/crypto/src/jwtVerifier.ts';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';

const signer = createJwtSigner();
const verifier = createJwtVerifier();

function claims(overrides: Record<string, unknown> = {}) {
  return { iss: 'iss', sub: 'agent-1', aud: 'https://conduit.example', iat: 1000, exp: 2000, jti: 'jti-1', ...overrides };
}

describe('Ed25519 keypair', () => {
  it('generates an OKP/Ed25519 JWK pair (public has no private scalar)', () => {
    const { publicKeyJwk, privateKeyJwk } = generateEd25519KeyPair();
    assert.equal(publicKeyJwk.kty, 'OKP');
    assert.equal(publicKeyJwk.crv, 'Ed25519');
    assert.ok(publicKeyJwk.x.length > 0);
    assert.equal((publicKeyJwk as { d?: string }).d, undefined);
    assert.ok(privateKeyJwk.d.length > 0);
  });
});

describe('EdDSA JWT sign/verify', () => {
  it('round-trips: a signed JWT verifies with the matching public key', async () => {
    const kp = generateEd25519KeyPair();
    const token = await signer.sign('agent+jwt', claims() as never, kp.privateKeyJwk);
    const result = await verifier.verify(token, kp.publicKeyJwk);
    assert.equal(result.typ, 'agent+jwt');
    assert.equal((result.claims as { sub: string }).sub, 'agent-1');
  });

  it('decodeJwt reads typ/claims without verifying', async () => {
    const kp = generateEd25519KeyPair();
    const token = await signer.sign('host+jwt', claims({ sub: undefined }) as never, kp.privateKeyJwk);
    const decoded = decodeJwt(token);
    assert.equal(decoded.typ, 'host+jwt');
    assert.equal((decoded.claims as { iss: string }).iss, 'iss');
  });

  it('rejects a tampered payload', async () => {
    const kp = generateEd25519KeyPair();
    const token = await signer.sign('agent+jwt', claims() as never, kp.privateKeyJwk);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify(claims({ sub: 'attacker' })), 'utf8').toString('base64url');
    await assert.rejects(() => verifier.verify(`${h}.${forged}.${s}`, kp.publicKeyJwk));
  });

  it('rejects verification with a different key', async () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    const token = await signer.sign('agent+jwt', claims() as never, a.privateKeyJwk);
    await assert.rejects(() => verifier.verify(token, b.publicKeyJwk));
  });

  it('the generated public key has a stable RFC 7638 thumbprint', () => {
    const { publicKeyJwk } = generateEd25519KeyPair();
    const t1 = jwkThumbprint(publicKeyJwk);
    assert.match(t1, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(t1, jwkThumbprint(publicKeyJwk));
  });
});
