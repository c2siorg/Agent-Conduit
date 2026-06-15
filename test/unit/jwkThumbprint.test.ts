import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';

// RFC 8037 Appendix A.3 example Ed25519 public key.
const JWK = { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' } as const;

describe('jwkThumbprint (RFC 7638)', () => {
  it('is deterministic', () => {
    assert.equal(jwkThumbprint(JWK), jwkThumbprint(JWK));
  });

  it('produces a 43-char url-safe base64 SHA-256 (no padding)', () => {
    const t = jwkThumbprint(JWK);
    assert.equal(t.length, 43);
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  });

  it('is independent of input member order (canonicalization)', () => {
    const reordered = { x: JWK.x, crv: JWK.crv, kty: JWK.kty } as const;
    assert.equal(jwkThumbprint(reordered), jwkThumbprint(JWK));
  });

  it('matches the known thumbprint for the RFC 8037 A.3 key', () => {
    assert.equal(jwkThumbprint(JWK), 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k');
  });
});
