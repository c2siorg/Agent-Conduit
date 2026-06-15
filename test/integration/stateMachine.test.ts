import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

const DB_URL = process.env.CONDUIT_TEST_DATABASE_URL;

function freshJwk() {
  return { kty: 'OKP', crv: 'Ed25519', x: randomBytes(32).toString('base64url') } as const;
}

describe(
  'state machine (every status change routes through it)',
  { skip: DB_URL ? false : 'set CONDUIT_TEST_DATABASE_URL to run' },
  () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let driver: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let machine: any;

    before(async () => {
      const { PostgresStorageDriver } = await import(
        '../../packages/storage/src/drivers/postgres/postgresDriver.ts'
      );
      const { createStateMachine } = await import('../../apps/server/src/identity/stateMachine.ts');
      driver = new PostgresStorageDriver({ connectionString: DB_URL });
      await driver.init();
      await driver.migrate();
      machine = createStateMachine(driver);
    });

    after(async () => {
      if (driver) {
        await driver.close();
      }
    });

    async function newAgent(status: string) {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'active',
      });
      return driver.agents.create({
        hostId: host.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status,
      });
    }

    it('performs a legal agent transition and persists it', async () => {
      const agent = await newAgent('pending');
      const updated = await machine.transitionAgent(agent.id, 'active');
      assert.equal(updated.status, 'active');
      assert.equal((await driver.agents.findById(agent.id)).status, 'active');
    });

    it('rejects an illegal agent transition and leaves status unchanged', async () => {
      const agent = await newAgent('active');
      await assert.rejects(() => machine.transitionAgent(agent.id, 'pending'));
      assert.equal((await driver.agents.findById(agent.id)).status, 'active');
    });

    it('rejects a transition for a non-existent agent', async () => {
      await assert.rejects(() =>
        machine.transitionAgent('00000000-0000-0000-0000-000000000000', 'active'),
      );
    });

    it('performs a legal host transition', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'pending',
      });
      const updated = await machine.transitionHost(host.id, 'active');
      assert.equal(updated.status, 'active');
    });

    it('rejects an illegal host transition', async () => {
      const host = await driver.hosts.create({
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        userId: null,
        defaultCapabilities: [],
        status: 'pending',
      });
      await machine.transitionHost(host.id, 'active');
      await assert.rejects(() => machine.transitionHost(host.id, 'pending'));
    });
  },
);
