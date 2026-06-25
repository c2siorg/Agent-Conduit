import { generateEd25519KeyPair, jwkThumbprint } from '@conduit/crypto';
import { PostgresStorageDriver, type PostgresConfig } from '@conduit/storage';
import { loadConfig } from '../config/configLoader.js';

/**
 * Admin host bootstrap.
 *
 * Generates an Ed25519 keypair, creates an ACTIVE host with the public key, and prints the host id,
 * its issuer (RFC 7638 thumbprint), and the host PRIVATE JWK. A client signs `host+jwt`s with that
 * private key (iss = the thumbprint) to register agents. Run once per host; keep the private key safe.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const pg = config.storage.postgres;
  if (!pg) {
    throw new Error('storage.postgres is not configured');
  }
  const driverConfig: PostgresConfig = {
    host: pg.host,
    port: pg.port,
    database: pg.database,
    user: pg.user,
    // Local-stack default so this works against docker compose without exporting PGPASSWORD.
    password: process.env['PGPASSWORD'] ?? 'conduit',
  };

  const storage = new PostgresStorageDriver(driverConfig);
  await storage.init();
  await storage.migrate();

  const kp = generateEd25519KeyPair();
  // Initial state is active (a bootstrap creation, not a transition).
  const host = await storage.hosts.create({
    publicKeyJwk: kp.publicKeyJwk,
    jwksUrl: null,
    userId: null,
    defaultCapabilities: [],
    status: 'active',
  });
  await storage.close();

  const out = {
    hostId: host.id,
    issuer: jwkThumbprint(kp.publicKeyJwk),
    hostPrivateKeyJwk: kp.privateKeyJwk,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`bootstrap failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
