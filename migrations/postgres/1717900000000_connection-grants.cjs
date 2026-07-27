/* Agent ↔ connector authorization: which connectors an agent may use, with scoped ops + a rate limit. */
exports.up = (pgm) => {
  pgm.createTable('connection_grants', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    agent_id: { type: 'uuid', notNull: true, references: 'agents', onDelete: 'CASCADE' },
    connection_id: { type: 'uuid', notNull: true, references: 'connections', onDelete: 'CASCADE' },
    allowed_operations: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    rate_limit: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // One authorization per (agent, connection) — attach is idempotent/updatable.
  pgm.addConstraint('connection_grants', 'connection_grants_agent_connection_unique', {
    unique: ['agent_id', 'connection_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('connection_grants');
};
