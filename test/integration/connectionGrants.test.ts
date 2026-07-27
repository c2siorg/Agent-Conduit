import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const DB_URL = process.env.CONDUIT_TEST_DATABASE_URL;

describe(
  'connection grants repository (Postgres — agent ↔ connector authorization)',
  { skip: DB_URL ? false : 'set CONDUIT_TEST_DATABASE_URL to run' },
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let driver: any;
    let agentId = '';
    let connectionId = '';

    before(async () => {
      const { PostgresStorageDriver } = await import('../../packages/storage/src/drivers/postgres/postgresDriver.ts');
      driver = new PostgresStorageDriver({ connectionString: DB_URL });
      await driver.init();
      await driver.migrate();
      // A host -> agent -> connection to reference (FKs are real).
      const host = await driver.hosts.create({ publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'aaa' }, jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });
      const agent = await driver.agents.create({ hostId: host.id, publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'bbb' }, jwksUrl: null, name: 'cg', description: null, mode: 'delegated', status: 'active' });
      const conn = await driver.connections.create({ name: 'cg-conn', platform: 'mock', credentialEncrypted: new Uint8Array([1, 2, 3]), allowedOperations: ['echo'] });
      agentId = agent.id;
      connectionId = conn.id;
    });

    after(async () => {
      if (driver) {
        await driver.close();
      }
    });

    it('upserts (idempotent on agent+connection), lists, and deletes', async () => {
      const g1 = await driver.connectionGrants.upsert({ agentId, connectionId, allowedOperations: ['echo'], rateLimit: 5 });
      assert.equal(g1.agentId, agentId);
      assert.deepEqual(g1.allowedOperations, ['echo']);
      assert.equal(g1.rateLimit, 5);

      // Upsert again with different values -> same row updated (unique constraint holds).
      const g2 = await driver.connectionGrants.upsert({ agentId, connectionId, allowedOperations: [], rateLimit: null });
      assert.equal(g2.id, g1.id);
      assert.deepEqual(g2.allowedOperations, []);
      assert.equal(g2.rateLimit, null);

      const list = await driver.connectionGrants.listByAgent(agentId);
      assert.equal(list.length, 1);

      const found = await driver.connectionGrants.findForAgent(agentId, connectionId);
      assert.ok(found);

      await driver.connectionGrants.delete(agentId, connectionId);
      assert.equal((await driver.connectionGrants.listByAgent(agentId)).length, 0);
    });
  },
);
