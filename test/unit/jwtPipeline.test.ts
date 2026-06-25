import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { generateEd25519KeyPair } from '../../packages/crypto/src/keyPair.ts';
import { jwkThumbprint } from '../../packages/crypto/src/jwkThumbprint.ts';
import { createJwtSigner } from '../../packages/crypto/src/jwtSigner.ts';
import { createJwtVerifier } from '../../packages/crypto/src/jwtVerifier.ts';
import {
  buildAgentPipeline,
  buildHostPipeline,
} from '../../apps/server/src/auth/stages/index.ts';

const ISSUER = 'https://conduit.test';
const signer = createJwtSigner();
const config = { issuer: ISSUER, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 };

const hostKp = generateEd25519KeyPair();
const hostThumb = jwkThumbprint(hostKp.publicKeyJwk);
const agentKp = generateEd25519KeyPair();

let host: any;
let agent: any;
let storage: any;
let jtiCounter = 0;

function deps() {
  return { verifier: createJwtVerifier(), storage, constraintEngine: {}, config };
}
function run(token: string, expectedTyp = 'agent+jwt') {
  const pipeline = expectedTyp === 'host+jwt' ? buildHostPipeline(deps()) : buildAgentPipeline(deps());
  return pipeline.run({ token, expectedTyp } as never);
}
function nowSec() {
  return Math.floor(Date.now() / 1000);
}
function signAgent(over: Record<string, unknown> = {}, key = agentKp.privateKeyJwk) {
  const n = nowSec();
  const claims = { iss: hostThumb, sub: 'agent-1', aud: ISSUER, iat: n, exp: n + 60, jti: `jti-${++jtiCounter}`, ...over };
  return signer.sign('agent+jwt', claims as never, key);
}
function signHost(over: Record<string, unknown> = {}, key = hostKp.privateKeyJwk) {
  const n = nowSec();
  const claims = { iss: hostThumb, aud: ISSUER, iat: n, exp: n + 300, jti: `jti-${++jtiCounter}`, ...over };
  return signer.sign('host+jwt', claims as never, key);
}

beforeEach(() => {
  host = {
    id: 'host-1', publicKeyJwk: hostKp.publicKeyJwk, jwksUrl: null, userId: null,
    defaultCapabilities: [], status: 'active', createdAt: new Date(), updatedAt: new Date(),
  };
  agent = {
    id: 'agent-1', hostId: 'host-1', publicKeyJwk: agentKp.publicKeyJwk, jwksUrl: null,
    status: 'active', mode: 'delegated', activatedAt: new Date(), sessionExpiresAt: null,
    maxLifetimeExpiresAt: null, absoluteExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const seen = new Set<string>();
  storage = {
    hosts: {
      findByThumbprint: async (iss: string) => (iss === hostThumb ? host : null),
      findById: async (id: string) => (id === host.id ? host : null),
    },
    agents: {
      findBySubject: async (sub: string) => (sub === agent.id ? agent : null),
      findById: async (id: string) => (id === agent.id ? agent : null),
    },
    jtiCache: {
      put: async (jti: string) => (seen.has(jti) ? false : (seen.add(jti), true)),
    },
  };
});

const isCode = (code: string) => (e: unknown) => (e as { code?: string }).code === code;

describe('JWT pipeline (agent, stages 1-4)', () => {
  it('accepts a valid agent JWT', async () => {
    await assert.doesNotReject(run(await signAgent()));
  });

  it('rejects token confusion (agent token at a host endpoint)', async () => {
    await assert.rejects(run(await signAgent(), 'host+jwt'), isCode('invalid_jwt'));
  });

  it('rejects a bad signature (signed with a different key)', async () => {
    const wrong = generateEd25519KeyPair().privateKeyJwk;
    await assert.rejects(run(await signAgent({}, wrong)), isCode('invalid_jwt'));
  });

  it('rejects an expired token', async () => {
    const n = nowSec();
    await assert.rejects(run(await signAgent({ iat: n - 200, exp: n - 100 })), isCode('invalid_jwt'));
  });

  it('rejects an iat too far in the future', async () => {
    const n = nowSec();
    await assert.rejects(run(await signAgent({ iat: n + 1000, exp: n + 2000 })), isCode('invalid_jwt'));
  });

  it('rejects a replayed jti (same token twice)', async () => {
    const token = await signAgent();
    await assert.doesNotReject(run(token));
    await assert.rejects(run(token), isCode('invalid_jwt'));
  });

  it('rejects a revoked agent at the state stage', async () => {
    agent.status = 'revoked';
    await assert.rejects(run(await signAgent()), isCode('agent_revoked'));
  });

  it('rejects a pending agent', async () => {
    agent.status = 'pending';
    await assert.rejects(run(await signAgent()), isCode('agent_pending'));
  });

  it('rejects when the parent host is revoked', async () => {
    host.status = 'revoked';
    await assert.rejects(run(await signAgent()), isCode('host_revoked'));
  });

  it('rejects an absolute-lifetime-exceeded agent', async () => {
    agent.absoluteExpiresAt = new Date(Date.now() - 1000);
    await assert.rejects(run(await signAgent()), isCode('absolute_lifetime_exceeded'));
  });
});

describe('JWT pipeline (host, stages 1-4)', () => {
  it('accepts a valid host JWT', async () => {
    await assert.doesNotReject(run(await signHost(), 'host+jwt'));
  });

  it('rejects a pending host', async () => {
    host.status = 'pending';
    await assert.rejects(run(await signHost(), 'host+jwt'), isCode('host_pending'));
  });
});
