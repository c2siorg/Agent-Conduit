import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

const DB_URL = process.env.CONDUIT_TEST_DATABASE_URL;

describe(
  'jti replay cache (expiry-aware)',
  { skip: DB_URL ? false : 'set CONDUIT_TEST_DATABASE_URL to run' },
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let driver: any;

    before(async () => {
      const { PostgresStorageDriver } = await import(
        '../../packages/storage/src/drivers/postgres/postgresDriver.ts'
      );
      driver = new PostgresStorageDriver({ connectionString: DB_URL });
      await driver.init();
      await driver.migrate();
    });

    after(async () => {
      if (driver) {
        await driver.close();
      }
    });

    it('accepts a fresh jti and rejects an unexpired replay', async () => {
      const jti = randomUUID();
      const future = new Date(Date.now() + 60_000);
      assert.equal(await driver.jtiCache.put(jti, future), true);
      assert.equal(await driver.jtiCache.put(jti, future), false);
    });

    it('reclaims an expired jti (so it is not treated as a replay)', async () => {
      const jti = randomUUID();
      const past = new Date(Date.now() - 60_000);
      assert.equal(await driver.jtiCache.put(jti, past), true);
      assert.equal(await driver.jtiCache.put(jti, past), true);
    });

    it('purgeExpired removes only expired rows', async () => {
      const live = randomUUID();
      const dead = randomUUID();
      await driver.jtiCache.put(live, new Date(Date.now() + 60_000));
      await driver.jtiCache.put(dead, new Date(Date.now() - 60_000));
      const removed = await driver.jtiCache.purgeExpired(new Date());
      assert.ok(removed >= 1);
      assert.equal(await driver.jtiCache.has(live), true);
      assert.equal(await driver.jtiCache.has(dead), false);
    });
  },
);
