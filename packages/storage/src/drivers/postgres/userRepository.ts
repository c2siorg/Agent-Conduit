import type { User } from '@conduit/core';
import type { NewUser, UserRepository } from '../../repositories.js';
import type { Queryable } from './queryable.js';

const COLS = 'id, username, password_hash, created_at, updated_at';

type Row = {
  id: string;
  username: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
};

function map(r: Row): User {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Postgres-backed {@link UserRepository}. Stores only the scrypt hash — never plaintext. */
export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: () => Queryable) {}

  async create(input: NewUser): Promise<User> {
    const { rows } = await this.db().query<Row>(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING ${COLS}`,
      [input.username, input.passwordHash],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('user insert returned no row');
    }
    return map(row);
  }

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await this.db().query<Row>(`SELECT ${COLS} FROM users WHERE username = $1`, [username]);
    return rows[0] ? map(rows[0]) : null;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db().query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
      id,
      passwordHash,
    ]);
  }
}
