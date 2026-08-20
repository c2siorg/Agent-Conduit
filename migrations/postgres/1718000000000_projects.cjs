/* Projects: a governance boundary for per-project credential isolation (Conduit extension). */
exports.up = (pgm) => {
  pgm.createTable('projects', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Agents and connections belong to a project (nullable = unassigned/global; SET NULL on project delete).
  pgm.addColumns('agents', { project_id: { type: 'uuid', references: 'projects', onDelete: 'SET NULL' } });
  pgm.addColumns('connections', { project_id: { type: 'uuid', references: 'projects', onDelete: 'SET NULL' } });
};

exports.down = (pgm) => {
  pgm.dropColumns('connections', ['project_id']);
  pgm.dropColumns('agents', ['project_id']);
  pgm.dropTable('projects');
};
