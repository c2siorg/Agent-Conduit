'use strict';
/**
 * Authorization + execution schema (Sprint 2-3):
 *   connections       - governed platform credentials (AES-256-GCM ciphertext only).
 *   capability_grants - per-agent grants mapping a capability -> connection + operation, with constraints.
 *   audit_log         - per-agent audit trail (args HASH, never raw args).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('grant_status', ['active', 'pending', 'denied']);

  pgm.createTable('connections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    platform: { type: 'text', notNull: true },
    credential_encrypted: { type: 'bytea', notNull: true },
    allowed_operations: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('capability_grants', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    agent_id: { type: 'uuid', notNull: true, references: 'agents', onDelete: 'CASCADE' },
    capability: { type: 'text', notNull: true },
    connection_id: { type: 'uuid', references: 'connections', onDelete: 'SET NULL' },
    operation: { type: 'text' },
    status: { type: 'grant_status', notNull: true, default: 'active' },
    constraints: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    granted_by: { type: 'text' },
    denied_by: { type: 'text' },
    reason: { type: 'text' },
    expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('capability_grants', ['agent_id', 'capability']);

  pgm.createTable('audit_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    agent_id: { type: 'uuid' },
    host_id: { type: 'uuid' },
    event_type: { type: 'text', notNull: true },
    capability: { type: 'text' },
    connection_id: { type: 'uuid' },
    operation: { type: 'text' },
    outcome: { type: 'text', notNull: true },
    args_hash: { type: 'text' },
    duration_ms: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_log', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropTable('capability_grants');
  pgm.dropTable('connections');
  pgm.dropType('grant_status');
};
