# Migrations

Versioned schema migrations, **run automatically on startup** and via `npm run migrate`.

- Persistence is **pluggable** — each backend ships its own migration set behind the same command.
- **`postgres/`** — the default/reference set (`node-pg-migrate`): `jsonb`, `bytea`, array columns,
  row-level locking, `RETURNING`.
- **`mysql/`** — the equivalent set proving the abstraction (`jsonb→JSON`, `bytea→BLOB/VARBINARY`,
  array columns → normalized table or JSON).

Never hand-edit a live schema — every change is a new versioned migration.

## Tables (logical)
`hosts` · `agents` · `capability_grants` · `connections` · `connection_grants` · `tools` ·
`audit_log` · `jti_cache` (indexed on `expires_at` for fast replay detection; expired rows purged by a job).
