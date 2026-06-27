'use strict';
/**
 * jti replay cache (JWT pipeline stage 3).
 * Indexed on expires_at so the scheduled purge of the replay window is cheap.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('jti_cache', {
    jti: { type: 'text', primaryKey: true },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('jti_cache', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('jti_cache');
};
