/* Task-scoped ephemeral grants: a task bundles grants that auto-revoke on completion/TTL (Conduit ext). */
exports.up = (pgm) => {
  pgm.createType('task_status', ['active', 'completed', 'expired']);
  pgm.createTable('tasks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    agent_id: { type: 'uuid', notNull: true, references: 'agents', onDelete: 'CASCADE' },
    host_id: { type: 'uuid', notNull: true, references: 'hosts', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    purpose: { type: 'text' },
    status: { type: 'task_status', notNull: true, default: 'active' },
    expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.createIndex('tasks', 'agent_id');

  // Link grants + audit to a task.
  pgm.addColumns('capability_grants', {
    task_id: { type: 'uuid', references: 'tasks', onDelete: 'CASCADE' },
  });
  pgm.addColumns('audit_log', {
    task_id: { type: 'uuid' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('audit_log', ['task_id']);
  pgm.dropColumns('capability_grants', ['task_id']);
  pgm.dropTable('tasks');
  pgm.dropType('task_status');
};
