import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

/**
 * Integration tests for the Postgres host + agent data model.
 * Requires a throwaway Postgres database. Run with:
 *   CONDUIT_TEST_DATABASE_URL=postgres://conduit:conduit@localhost:5432/conduit_test npm test
 * Skipped automatically when that variable is unset.
 */
const DB_URL = process.env.CONDUIT_TEST_DATABASE_URL;

/** A fresh, unique inline JWK so each principal gets a distinct thumbprint (re-runnable). */
function freshJwk() {
  return { kty: 'OKP', crv: 'Ed25519', x: randomBytes(32).toString('base64url') } as const;
}

describe(
  'Postgres host + agent data model',
  { skip: DB_URL ? false : 'set CONDUIT_TEST_DATABASE_URL to run' },
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let driver: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let jwkThumbprint: (jwk: any) => string;

    before(async () => {
      const { PostgresStorageDriver } = await import(
        '../../packages/storage/src/drivers/postgres/postgresDriver.ts'
      );
      ({ jwkThumbprint } = await import('../../packages/crypto/src/jwkThumbprint.ts'));
      driver = new PostgresStorageDriver({ connectionString: DB_URL });
      await driver.init();
      await driver.migrate();
    });

    after(async () => {
      if (driver) {
        await driver.close();
      }
    });

    it('creates a host (pending) and reads it back', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: 'user-1',
        defaultCapabilities: ['post_message', 'create_issue'],
        status: 'pending',
      });
      assert.equal(host.status, 'pending');
      assert.deepEqual(host.defaultCapabilities, ['post_message', 'create_issue']);
      assert.ok(host.createdAt instanceof Date);

      const fetched = await driver.hosts.findById(host.id);
      assert.equal(fetched?.id, host.id);
      assert.equal(fetched?.userId, 'user-1');
    });

    it('looks up a host by its RFC 7638 thumbprint (iss)', async () => {
      const jwk = freshJwk();
      const host = await driver.hosts.create({
        publicKeyJwk: jwk,
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'active',
      });
      const found = await driver.hosts.findByThumbprint(jwkThumbprint(jwk));
      assert.equal(found?.id, host.id);
    });

    it('transitions host status and persists it', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'pending',
      });
      await driver.hosts.updateStatus(host.id, 'active');
      assert.equal((await driver.hosts.findById(host.id))?.status, 'active');
    });

    it('rejects a host with neither inline key nor JWKS URL (check constraint)', async () => {
      await assert.rejects(() =>
        driver.hosts.create({
          publicKeyJwk: null,
          jwksUrl: null,
          userId: null,
          defaultCapabilities: [],
          status: 'pending',
        }),
      );
    });

    it('creates an agent under a host with the three lifetime clocks null at registration', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'active',
      });
      const agent = await driver.agents.create({
        hostId: host.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'pending',
      });
      assert.equal(agent.status, 'pending');
      assert.equal(agent.mode, 'delegated');
      assert.equal(agent.activatedAt, null);
      assert.equal(agent.sessionExpiresAt, null);
      assert.equal(agent.maxLifetimeExpiresAt, null);
      assert.equal(agent.absoluteExpiresAt, null);
    });

    it('applies and updates the lifetime clocks', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'active',
      });
      const agent = await driver.agents.create({
        hostId: host.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'autonomous',
        status: 'active',
      });

      const activatedAt = new Date('2026-01-01T00:00:00.000Z');
      await driver.agents.applyLifetimes(agent.id, {
        activatedAt,
        sessionExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
        maxLifetimeExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
      });

      let fetched = await driver.agents.findBySubject(agent.id);
      assert.equal(fetched?.activatedAt?.toISOString(), activatedAt.toISOString());
      assert.equal(fetched?.absoluteExpiresAt?.toISOString(), '2026-06-01T00:00:00.000Z');

      const slid = new Date('2026-01-01T00:05:00.000Z');
      await driver.agents.touchSession(agent.id, slid);
      fetched = await driver.agents.findById(agent.id);
      assert.equal(fetched?.sessionExpiresAt?.toISOString(), slid.toISOString());
      // touchSession must not disturb the absolute clock
      assert.equal(fetched?.absoluteExpiresAt?.toISOString(), '2026-06-01T00:00:00.000Z');
    });

    it('lists agents by host', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'active',
      });
      await driver.agents.create({
        hostId: host.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'pending',
      });
      await driver.agents.create({
        hostId: host.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'pending',
      });
      const agents = await driver.agents.listByHost(host.id);
      assert.equal(agents.length, 2);
    });

    it('rejects an agent referencing a non-existent host (foreign key)', async () => {
      await assert.rejects(() =>
        driver.agents.create({
          hostId: '00000000-0000-0000-0000-000000000000',
          publicKeyJwk: freshJwk(),
          jwksUrl: null,
          mode: 'delegated',
          status: 'pending',
        }),
      );
    });

    it('enforces agent.mode immutability at the database level (AAP §2.2)', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'active',
      });
      const agent = await driver.agents.create({
        hostId: host.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'active',
      });
      // The BEFORE UPDATE trigger must reject any attempt to change mode.
      await assert.rejects(() => rawModeUpdate(DB_URL as string, agent.id));
    });
  },
);

/** Connect directly and try to mutate agent.mode; the DB trigger must reject it (so this rejects). */
async function rawModeUpdate(connectionString: string, agentId: string): Promise<void> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`UPDATE agents SET mode = 'autonomous' WHERE id = $1`, [agentId]);
  } finally {
    await pool.end();
  }
}
