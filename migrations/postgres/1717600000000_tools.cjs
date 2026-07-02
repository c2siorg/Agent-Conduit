/* Token Router: registered tools + per-tool schema cache (Sprint 4). */
exports.up = (pgm) => {
  pgm.createTable('tools', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true, unique: true },
    adapter_type: { type: 'text', notNull: true },
    adapter_config: { type: 'jsonb', notNull: true, default: '{}' },
    schema_cache: { type: 'jsonb' },
    schema_cached_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('tools');
};
