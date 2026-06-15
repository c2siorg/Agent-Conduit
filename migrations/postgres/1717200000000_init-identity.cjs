'use strict';
/**
 * Initial identity schema (node-pg-migrate).
 * Creates the AAP-aligned state enums plus the `hosts` and `agents` tables.
 *
 * - agent_state: six states (AAP §2.3)
 * - host_state:  four states (AAP §2.11)
 * - agent_mode:  delegated | autonomous, immutable after creation (enforced by a trigger)
 * - agents carry the three lifetime clocks (session / max / absolute — AAP §2.4)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // State + mode enums.
  pgm.createType('agent_state', ['pending', 'active', 'expired', 'revoked', 'rejected', 'claimed']);
  pgm.createType('host_state', ['active', 'pending', 'revoked', 'rejected']);
  pgm.createType('agent_mode', ['delegated', 'autonomous']);

  // hosts — persistent identity of a client environment.
  pgm.createTable('hosts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    public_key_jwk: { type: 'jsonb' },
    jwks_url: { type: 'text' },
    key_thumbprint: { type: 'text' }, // RFC 7638 thumbprint of the inline key (iss lookup)
    user_id: { type: 'text' },
    default_capabilities: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    status: { type: 'host_state', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // A host MUST present exactly one key-delivery mode (inline JWK or JWKS URL).
  pgm.addConstraint('hosts', 'hosts_key_present', {
    check: 'public_key_jwk IS NOT NULL OR jwks_url IS NOT NULL',
  });
  pgm.createIndex('hosts', 'key_thumbprint', {
    unique: true,
    where: 'key_thumbprint IS NOT NULL',
    name: 'hosts_key_thumbprint_uq',
  });
  pgm.createIndex('hosts', 'user_id');

  // agents — per-session runtime actor registered under a host.
  pgm.createTable('agents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    host_id: { type: 'uuid', notNull: true, references: 'hosts', onDelete: 'CASCADE' },
    public_key_jwk: { type: 'jsonb' },
    jwks_url: { type: 'text' },
    status: { type: 'agent_state', notNull: true, default: 'pending' },
    mode: { type: 'agent_mode', notNull: true },
    activated_at: { type: 'timestamptz' },
    session_expires_at: { type: 'timestamptz' }, // session TTL (slides per request)
    max_lifetime_expires_at: { type: 'timestamptz' }, // from last activation
    absolute_expires_at: { type: 'timestamptz' }, // from creation; on elapse -> permanent revoked
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('agents', 'agents_key_present', {
    check: 'public_key_jwk IS NOT NULL OR jwks_url IS NOT NULL',
  });
  pgm.createIndex('agents', 'host_id');
  pgm.createIndex('agents', 'status');

  // Enforce mode immutability at the database level (AAP §2.2).
  pgm.createFunction(
    'agents_mode_immutable',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       IF NEW.mode <> OLD.mode THEN
         RAISE EXCEPTION 'agent.mode is immutable';
       END IF;
       RETURN NEW;
     END;`,
  );
  pgm.createTrigger('agents', 'agents_mode_immutable_trg', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'agents_mode_immutable',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('agents'); // drops its trigger with it
  pgm.dropFunction('agents_mode_immutable', []);
  pgm.dropTable('hosts');
  pgm.dropType('agent_mode');
  pgm.dropType('host_state');
  pgm.dropType('agent_state');
};
