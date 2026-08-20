import type { Project } from '@conduit/core';
import type { NewProject, ProjectRepository } from '../../repositories.js';
import type { Queryable } from './queryable.js';

const COLS = 'id, name, description, created_at';

type Row = { id: string; name: string; description: string | null; created_at: Date };

function map(r: Row): Project {
  return { id: r.id, name: r.name, description: r.description, createdAt: r.created_at };
}

/** Postgres-backed {@link ProjectRepository}. */
export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly db: () => Queryable) {}

  async create(input: NewProject): Promise<Project> {
    const { rows } = await this.db().query<Row>(
      `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING ${COLS}`,
      [input.name, input.description],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('project insert returned no row');
    }
    return map(row);
  }

  async findById(id: string): Promise<Project | null> {
    const { rows } = await this.db().query<Row>(`SELECT ${COLS} FROM projects WHERE id = $1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  async list(): Promise<Project[]> {
    const { rows } = await this.db().query<Row>(`SELECT ${COLS} FROM projects ORDER BY name ASC`);
    return rows.map(map);
  }

  async delete(id: string): Promise<void> {
    await this.db().query(`DELETE FROM projects WHERE id = $1`, [id]);
  }
}
