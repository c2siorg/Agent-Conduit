import type { Task, TaskStatus } from '@conduit/core';
import type { Page, PageQuery } from '../../pagination.js';
import type { NewTask, TaskRepository } from '../../repositories.js';
import type { Queryable } from './queryable.js';

const COLS = 'id, agent_id, host_id, name, purpose, status, expires_at, created_at, completed_at';

type Row = {
  id: string;
  agent_id: string;
  host_id: string;
  name: string;
  purpose: string | null;
  status: TaskStatus;
  expires_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
};

function map(r: Row): Task {
  return {
    id: r.id,
    agentId: r.agent_id,
    hostId: r.host_id,
    name: r.name,
    purpose: r.purpose,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly db: () => Queryable) {}

  async create(input: NewTask): Promise<Task> {
    const { rows } = await this.db().query<Row>(
      `INSERT INTO tasks (agent_id, host_id, name, purpose, expires_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING ${COLS}`,
      [input.agentId, input.hostId, input.name, input.purpose, input.expiresAt],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('task insert returned no row');
    }
    return map(row);
  }

  async findById(id: string): Promise<Task | null> {
    const { rows } = await this.db().query<Row>(`SELECT ${COLS} FROM tasks WHERE id = $1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  async list(page: PageQuery): Promise<Page<Task>> {
    const limit = Math.min(Math.max(page.limit ?? 100, 1), 500);
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM tasks ORDER BY created_at DESC LIMIT $1`,
      [limit + 1],
    );
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map(map), hasMore, nextCursor: null };
  }

  async setStatus(id: string, status: TaskStatus, completedAt: Date | null): Promise<void> {
    await this.db().query(`UPDATE tasks SET status = $2::task_status, completed_at = $3 WHERE id = $1`, [
      id,
      status,
      completedAt,
    ]);
  }
}
