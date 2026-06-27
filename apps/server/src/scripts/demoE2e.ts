import { randomUUID } from 'node:crypto';
import { createJwtSigner, generateEd25519KeyPair, jwkThumbprint } from '@conduit/crypto';
import type { JwtTyp } from '@conduit/core';
import { PostgresStorageDriver, type PostgresConfig } from '@conduit/storage';
import { loadConfig } from '../config/configLoader.js';

/**
 * End-to-end Sprint 1 demo (run against the docker stack).
 *
 * 1. Bootstraps a host directly in the database.
 * 2. Signs a host JWT and registers an agent over HTTP (POST /agent/register).
 * 3. Signs an agent JWT and authenticates it (GET /agent/status).
 *
 * The gateway URL doubles as the JWT `aud`, so it MUST match the gateway's configured issuer
 * (CONDUIT_BASE_URL). Override with CONDUIT_DEMO_URL.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const base = process.env['CONDUIT_DEMO_URL'] ?? 'http://localhost:8443';
  // aud must equal the gateway's issuer (CONDUIT_BASE_URL), which can differ from the URL we connect to
  // (e.g. in-network http://conduit:8443 vs the gateway's advertised http://localhost:8443).
  const aud = process.env['CONDUIT_AUD'] ?? base;
  const pg = config.storage.postgres;
  if (!pg) {
    throw new Error('storage.postgres is not configured');
  }
  const driverConfig: PostgresConfig = {
    host: pg.host,
    port: pg.port,
    database: pg.database,
    user: pg.user,
    // Local-stack default so `npm run demo` works against docker compose without exporting PGPASSWORD.
    password: process.env['PGPASSWORD'] ?? 'conduit',
  };
  const storage = new PostgresStorageDriver(driverConfig);
  await storage.init();
  await storage.migrate();

  // 1) bootstrap a host
  const hostKp = generateEd25519KeyPair();
  await storage.hosts.create({
    publicKeyJwk: hostKp.publicKeyJwk,
    jwksUrl: null,
    userId: null,
    defaultCapabilities: [],
    status: 'active',
  });
  const issuer = jwkThumbprint(hostKp.publicKeyJwk);
  await storage.close();

  const signer = createJwtSigner();
  const sign = (typ: JwtTyp, claims: Record<string, unknown>, key: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    // Unique jti per token so repeated demo runs are never seen as a replay.
    return signer.sign(typ, { aud, iat: now, exp: now + 60, jti: randomUUID(), ...claims } as never, key);
  };

  // 2) register an agent with a host JWT
  const agentKp = generateEd25519KeyPair();
  const hostJwt = await sign('host+jwt', { iss: issuer }, hostKp.privateKeyJwk as unknown as Record<string, unknown>);
  const reg = await fetch(`${base}/agent/register`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      agent_public_key: agentKp.publicKeyJwk,
      mode: 'delegated',
      name: 'demo-agent',
      description: 'Created by npm run demo',
    }),
  });
  const regBody = (await reg.json()) as { agent_id?: string };
  process.stdout.write(`register -> ${reg.status} ${JSON.stringify(regBody)}\n`);
  if (!regBody.agent_id) {
    throw new Error('registration did not return an agent_id');
  }

  // 3) authenticate the agent
  const agentJwt = await sign(
    'agent+jwt',
    { iss: issuer, sub: regBody.agent_id },
    agentKp.privateKeyJwk as unknown as Record<string, unknown>,
  );
  const status = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${agentJwt}` } });
  process.stdout.write(`status   -> ${status.status} ${JSON.stringify(await status.json())}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`demo failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
