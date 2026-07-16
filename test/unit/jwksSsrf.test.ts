import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBlockedAddress } from '../../apps/server/src/auth/ipGuard.ts';
import { createJwksResolver, validateJwks } from '../../apps/server/src/auth/jwksResolver.ts';
import { SignatureVerifyStage } from '../../apps/server/src/auth/stages/signatureVerifyStage.ts';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { createJwtSigner } from '../../packages/crypto/src/jwtSigner.ts';
import { createJwtVerifier } from '../../packages/crypto/src/jwtVerifier.ts';

describe('IP guard blocks non-public addresses (SSRF §8.12)', () => {
  it('blocks loopback/private/link-local/metadata/multicast', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
    }
  });
  it('allows routable public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
    }
  });
});

describe('JWKS validation', () => {
  it('keeps only Ed25519 keys and rejects junk', () => {
    const keys = validateJwks(JSON.stringify({ keys: [{ kty: 'RSA', n: 'x' }, { kty: 'OKP', crv: 'Ed25519', x: 'abc', kid: 'k1' }] }), 20);
    assert.equal(keys.length, 1);
    assert.equal((keys[0] as { kid?: string }).kid, 'k1');
    assert.throws(() => validateJwks('{"keys":[]}', 20));
    assert.throws(() => validateJwks('not json', 20));
    assert.throws(() => validateJwks(JSON.stringify({ keys: Array(50).fill({ kty: 'OKP', crv: 'Ed25519', x: 'a' }) }), 20));
  });
});

describe('SSRF-hardened JWKS resolver', () => {
  const jwksBody = JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'AAA' }] });

  it('refuses non-https and credentialed URLs', async () => {
    const r = createJwksResolver({ lookup: async () => ['8.8.8.8'], httpGet: async () => jwksBody });
    await assert.rejects(r.resolve('http://keys.example/jwks'), /https/);
    await assert.rejects(r.resolve('https://user:pw@keys.example/jwks'), /credentials/);
  });

  it('rejects a host resolving to a blocked address BEFORE fetching', async () => {
    let fetched = false;
    const r = createJwksResolver({ lookup: async () => ['169.254.169.254'], httpGet: async () => { fetched = true; return jwksBody; } });
    await assert.rejects(r.resolve('https://metadata.evil/jwks'), /blocked address/);
    assert.equal(fetched, false); // never connected
  });

  it('pins the validated IP, validates the body, and caches', async () => {
    let calls = 0;
    let pinnedIp = '';
    const r = createJwksResolver({
      lookup: async () => ['8.8.8.8'],
      httpGet: async ({ ip }) => { calls += 1; pinnedIp = ip; return jwksBody; },
    });
    const key = await r.resolve('https://keys.example/jwks');
    assert.equal((key as { x: string }).x, 'AAA');
    assert.equal(pinnedIp, '8.8.8.8');
    await r.resolve('https://keys.example/jwks'); // cached
    assert.equal(calls, 1);
  });

  it('allows private hosts only when explicitly enabled', async () => {
    const r = createJwksResolver({ allowPrivateHosts: true, lookup: async () => ['127.0.0.1'], httpGet: async () => jwksBody });
    const key = await r.resolve('https://internal.jwks/keys');
    assert.equal((key as { x: string }).x, 'AAA');
  });
});

describe('signature stage resolves a key via jwksUrl', () => {
  it('verifies against a JWKS-fetched key when there is no inline key', async () => {
    const kp = generateEd25519KeyPair();
    const agent = { id: 'agent-1', hostId: 'host-1', publicKeyJwk: null, jwksUrl: 'https://keys.example/jwks', status: 'active' };
    const storage: any = {
      agents: { findBySubject: async () => agent },
      hosts: { findById: async () => ({ id: 'host-1', status: 'active' }) },
    };
    const resolver = { resolve: async () => kp.publicKeyJwk }; // stand-in for the guarded fetch
    const stage = new SignatureVerifyStage(createJwtVerifier(), storage, resolver as any);

    const now = Math.floor(Date.now() / 1000);
    const token = await createJwtSigner().sign('agent+jwt', { sub: 'agent-1', iss: 'host-thumb', aud: 'x', iat: now, exp: now + 60, jti: 'j1' } as never, kp.privateKeyJwk);
    const ctx: any = { token, expectedTyp: 'agent+jwt' };
    await stage.execute(ctx);
    assert.equal(ctx.agent.id, 'agent-1');

    // With no inline key AND no resolver -> rejected.
    const stageNoResolver = new SignatureVerifyStage(createJwtVerifier(), storage);
    await assert.rejects(stageNoResolver.execute({ token, expectedTyp: 'agent+jwt' } as any), /no verifiable key/);
  });
});
