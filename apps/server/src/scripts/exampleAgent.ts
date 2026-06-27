import { randomUUID } from 'node:crypto';
import { createJwtSigner, generateEd25519KeyPair, jwkThumbprint } from '@conduit/crypto';
import type { JwtTyp } from '@conduit/core';
import { PostgresStorageDriver, type PostgresConfig } from '@conduit/storage';
import { loadConfig } from '../config/configLoader.js';

/**
 * Self-contained example agent (no external API key). It:
 *   1. bootstraps a host directly in the database,
 *   2. registers itself as a named agent over HTTP,
 *   3. heartbeats forever - minting a fresh agent JWT and asking Conduit to verify it (/agent/status).
 *
 * Revoke it in the dashboard to watch the heartbeat flip to DENIED while the gateway stays up - the live
 * "kill one agent instantly" demonstration.
 */
const HEARTBEAT_MS = Number(process.env['EXAMPLE_HEARTBEAT_MS'] ?? '15000');
const AGENT_NAME = process.env['EXAMPLE_AGENT_NAME'] ?? 'example-heartbeat-agent';

function log(msg: string): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), agent: AGENT_NAME, msg })}\n`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const base = process.env['CONDUIT_DEMO_URL'] ?? 'http://localhost:8443';
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
    password: process.env['PGPASSWORD'] ?? 'conduit',
  };

  // 1) bootstrap a host
  const storage = new PostgresStorageDriver(driverConfig);
  await storage.init();
  await storage.migrate();
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
    return signer.sign(typ, { aud, iat: now, exp: now + 60, jti: randomUUID(), ...claims } as never, key);
  };

  // 2) register this agent
  const agentKp = generateEd25519KeyPair();
  const hostJwt = await sign('host+jwt', { iss: issuer }, hostKp.privateKeyJwk as unknown as Record<string, unknown>);
  const reg = await fetch(`${base}/agent/register`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hostJwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      agent_public_key: agentKp.publicKeyJwk,
      mode: 'delegated',
      name: AGENT_NAME,
      description: 'Self-contained heartbeat example agent.',
    }),
  });
  const regBody = (await reg.json()) as { agent_id?: string };
  if (!reg.ok || !regBody.agent_id) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(regBody)}`);
  }
  const agentId = regBody.agent_id;
  log(`registered (${agentId}); heartbeating every ${HEARTBEAT_MS}ms`);

  // 3) heartbeat: prove identity to Conduit on a loop
  let running = true;
  const stop = (): void => {
    running = false;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (running) {
    try {
      const agentJwt = await sign(
        'agent+jwt',
        { iss: issuer, sub: agentId },
        agentKp.privateKeyJwk as unknown as Record<string, unknown>,
      );
      const res = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${agentJwt}` } });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        log(`heartbeat ok: identity verified (status=${String(body.status)})`);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        log(`heartbeat DENIED: ${res.status} ${body.error ?? ''} - this agent can no longer act`);
      }
    } catch (err) {
      log(`heartbeat error: gateway unreachable (${err instanceof Error ? err.message : String(err)})`);
    }
    await sleep(HEARTBEAT_MS);
  }
  log('stopped');
}

main().catch((err: unknown) => {
  process.stderr.write(`example agent failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
