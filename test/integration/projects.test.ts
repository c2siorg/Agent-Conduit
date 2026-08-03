import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

/**
 * Integration tests for project-scoped credential isolation against real Postgres.
 * Requires a throwaway database. Run with:
 *   CONDUIT_TEST_DATABASE_URL=postgres://conduit:conduit@localhost:5432/conduit_test npm test
 * Skipped automatically when that variable is unset.
 *
 * Covers the columns + FK behavior the isolation logic relies on: project_id on agents/connections,
 * the setProject / connection-update paths, and `ON DELETE SET NULL` (deleting a project must not
 * cascade-delete its members — the app-layer delete-guard is what prevents the widening; the DB just
 * nulls the reference).
 */
const DB_URL = process.env.CONDUIT_TEST_DATABASE_URL;

function freshJwk() {
  return { kty: 'OKP', crv: 'Ed25519', x: randomBytes(32).toString('base64url') } as const;
}

describe(
  'Postgres project-scoped isolation',
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

    const newHost = () =>
      driver.hosts.create({ publicKeyJwk: freshJwk(), jwksUrl: null, userId: null, defaultCapabilities: [], status: 'active' });

    it('creates a project and reads it back', async () => {
      const project = await driver.projects.create({ name: 'team-alpha', description: 'the alpha squad' });
      assert.ok(project.id);
      assert.equal(project.name, 'team-alpha');
      assert.equal(project.description, 'the alpha squad');
      assert.ok(project.createdAt instanceof Date);

      const fetched = await driver.projects.findById(project.id);
      assert.equal(fetched?.id, project.id);
      const listed = await driver.projects.list();
      assert.ok(listed.some((p: { id: string }) => p.id === project.id));
    });

    it('persists project_id on an agent and reassigns it', async () => {
      const host = await newHost();
      const projA = await driver.projects.create({ name: 'proj-a', description: null });
      const projB = await driver.projects.create({ name: 'proj-b', description: null });

      const agent = await driver.agents.create({
        hostId: host.id,
        projectId: projA.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'active',
      });
      assert.equal(agent.projectId, projA.id);

      await driver.agents.setProject(agent.id, projB.id);
      assert.equal((await driver.agents.findById(agent.id))?.projectId, projB.id);

      await driver.agents.setProject(agent.id, null);
      assert.equal((await driver.agents.findById(agent.id))?.projectId, null);
    });

    it('defaults a project-less agent to null (global)', async () => {
      const host = await newHost();
      const agent = await driver.agents.create({
        hostId: host.id,
        projectId: null,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'active',
      });
      assert.equal(agent.projectId, null);
    });

    it('persists project_id on a connection and reassigns it via update', async () => {
      const proj = await driver.projects.create({ name: 'conn-proj', description: null });
      const conn = await driver.connections.create({
        name: 'slack-scoped',
        projectId: proj.id,
        platform: 'slack',
        credentialEncrypted: randomBytes(48),
        allowedOperations: ['post_message'],
      });
      assert.equal(conn.projectId, proj.id);

      const updated = await driver.connections.update(conn.id, { projectId: null });
      assert.equal(updated?.projectId, null);

      const reassigned = await driver.connections.update(conn.id, { projectId: proj.id });
      assert.equal(reassigned?.projectId, proj.id);
    });

    it('rejects an agent referencing a non-existent project (foreign key)', async () => {
      const host = await newHost();
      await assert.rejects(() =>
        driver.agents.create({
          hostId: host.id,
          projectId: '00000000-0000-0000-0000-000000000000',
          publicKeyJwk: freshJwk(),
          jwksUrl: null,
          mode: 'delegated',
          status: 'active',
        }),
      );
    });

    it('ON DELETE SET NULL: deleting a project nulls members rather than cascading a delete', async () => {
      const host = await newHost();
      const proj = await driver.projects.create({ name: 'ephemeral', description: null });
      const agent = await driver.agents.create({
        hostId: host.id,
        projectId: proj.id,
        publicKeyJwk: freshJwk(),
        jwksUrl: null,
        mode: 'delegated',
        status: 'active',
      });
      const conn = await driver.connections.create({
        name: 'ephemeral-conn',
        projectId: proj.id,
        platform: 'slack',
        credentialEncrypted: randomBytes(48),
        allowedOperations: [],
      });

      await driver.projects.delete(proj.id);

      // The members survive (no cascade) but are now global.
      assert.equal((await driver.agents.findById(agent.id))?.projectId, null);
      assert.equal((await driver.connections.findById(conn.id))?.projectId, null);
    });
  },
);
