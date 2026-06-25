// In-browser Ed25519 (WebCrypto) so the dashboard can act as the AAP Client without the server ever
// seeing a private key. The operator's host key and the generated agent key stay in the browser.

export interface Ed25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d?: string;
}

function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 1) {
    bin += String.fromCharCode(arr[i]!);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToB64url(value: unknown): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** RFC 7638 thumbprint (the host `iss`), computed in-browser from the public key material. */
export async function jwkThumbprint(jwk: { crv: string; kty: string; x: string }): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return bytesToB64url(digest);
}

/** Feature-detect WebCrypto Ed25519 (current Chrome/Firefox/Safari support it). */
export async function ed25519Supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

export async function generateAgentKeyPair(): Promise<{ publicKeyJwk: Ed25519Jwk; privateKeyJwk: Ed25519Jwk }> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as Ed25519Jwk;
  const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as Ed25519Jwk;
  // Canonical members only (strip key_ops/ext that WebCrypto adds).
  return {
    publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: pub.x },
    // A private-key export always includes the private scalar `d`.
    privateKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: priv.x, d: priv.d ?? '' },
  };
}

/**
 * Parse the operator host key the user pastes into the dashboard. Accepts either the bare Ed25519 PRIVATE
 * JWK or the full `bootstrap:host` output (it unwraps `hostPrivateKeyJwk`). Throws a clear, actionable
 * error if the value is not a usable private signing key — otherwise WebCrypto later fails with the
 * cryptic "Cannot create a key using the specified key usages".
 */
export function parseHostKey(raw: string): Ed25519Jwk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Operator host key is not valid JSON.');
  }
  // Tolerate pasting the whole bootstrap output, not just the inner key.
  const candidate =
    parsed && typeof parsed === 'object' && 'hostPrivateKeyJwk' in parsed
      ? (parsed as { hostPrivateKeyJwk: unknown }).hostPrivateKeyJwk
      : parsed;
  const jwk = candidate as Partial<Ed25519Jwk> | null;
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x || !jwk.d) {
    throw new Error(
      'Operator host key must be the Ed25519 PRIVATE JWK (with a "d" field). Paste the "hostPrivateKeyJwk" object from bootstrap:host — not the whole output and not the public key.',
    );
  }
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d };
}

/** Sign a `host+jwt` in-browser with the operator's host private key; `iss` is derived from the key. */
export async function signHostJwt(hostPrivateKeyJwk: Ed25519Jwk, aud: string): Promise<string> {
  const iss = await jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: hostPrivateKeyJwk.x });
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'EdDSA', typ: 'host+jwt' };
  const payload = { iss, aud, iat: now, exp: now + 60, jti: crypto.randomUUID() };
  const signingInput = `${jsonToB64url(header)}.${jsonToB64url(payload)}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: hostPrivateKeyJwk.x, d: hostPrivateKeyJwk.d } as JsonWebKey,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToB64url(sig)}`;
}
