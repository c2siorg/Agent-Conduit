import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAgentConfiguration } from '../../apps/server/src/routes/wellKnownRoutes.ts';
import {
  AAP_SUPPORTED_MAJOR,
  AAP_VERSION,
  isSupportedVersion,
  parseMajorVersion,
} from '../../packages/core/src/types/discovery.ts';

// The builder only reads config.server.baseUrl; tests run via tsx (no typecheck).
const doc = buildAgentConfiguration({ server: { baseUrl: 'https://issuer.example/' } } as never);

const REQUIRED_FIELDS = [
  'version',
  'provider_name',
  'description',
  'issuer',
  'algorithms',
  'modes',
  'approval_methods',
  'endpoints',
];

const ENDPOINT_KEYS = [
  'register',
  'capabilities',
  'describe_capability',
  'execute',
  'request_capability',
  'status',
  'reactivate',
  'revoke',
  'revoke_host',
  'rotate_key',
  'rotate_host_key',
  'introspect',
];

describe('discovery document (AAP §5.1)', () => {
  it('advertises the supported protocol version (MAJOR.MINOR[-draft])', () => {
    assert.equal(doc.version, AAP_VERSION);
    assert.match(doc.version, /^\d+\.\d+/);
  });

  it('includes the full required field set', () => {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in doc, `missing required field: ${field}`);
    }
  });

  it('uses Ed25519 and advertises both modes', () => {
    assert.deepEqual(doc.algorithms, ['Ed25519']);
    assert.deepEqual(doc.modes, ['delegated', 'autonomous']);
  });

  it('derives issuer / jwks_uri / default_location from the base URL (trailing slash trimmed)', () => {
    assert.equal(doc.issuer, 'https://issuer.example');
    assert.equal(doc.jwks_uri, 'https://issuer.example/.well-known/jwks.json');
    assert.equal(doc.default_location, 'https://issuer.example/capability/execute');
  });

  it('exposes all 12 endpoint keys as relative paths', () => {
    assert.deepEqual(Object.keys(doc.endpoints).sort(), [...ENDPOINT_KEYS].sort());
    for (const value of Object.values(doc.endpoints)) {
      assert.ok((value as string).startsWith('/'), `expected a relative path, got: ${value as string}`);
    }
  });
});

describe('version check (AAP §5.1.1)', () => {
  it('parses the major version component', () => {
    assert.equal(parseMajorVersion('1.0-draft'), 1);
    assert.equal(parseMajorVersion('2.3'), 2);
    assert.equal(parseMajorVersion('garbage'), null);
  });

  it('accepts a matching major and rejects an unsupported one', () => {
    assert.ok(isSupportedVersion(`${AAP_SUPPORTED_MAJOR}.0-draft`));
    assert.ok(!isSupportedVersion('2.0'));
    assert.ok(!isSupportedVersion('not-a-version'));
  });
});
