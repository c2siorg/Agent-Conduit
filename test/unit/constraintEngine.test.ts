import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';
import { createConstraintEngine } from '../../apps/server/src/identity/constraintEngine.ts';

const engine = createConstraintEngine();

describe('constraint engine - validate (AAP §2.13)', () => {
  it('exact match passes; mismatch is a violation', () => {
    assert.deepEqual(engine.validate({ channel: '#general' }, { channel: '#general' }), []);
    const v = engine.validate({ channel: '#general' }, { channel: '#random' });
    assert.equal(v.length, 1);
    assert.equal(v[0].field, 'channel');
    assert.equal(v[0].actual, '#random');
  });

  it('max / min operators', () => {
    assert.deepEqual(engine.validate({ amount: { max: 100 } }, { amount: 50 }), []);
    assert.equal(engine.validate({ amount: { max: 100 } }, { amount: 150 }).length, 1);
    assert.deepEqual(engine.validate({ amount: { min: 10 } }, { amount: 10 }), []);
    assert.equal(engine.validate({ amount: { min: 10 } }, { amount: 5 }).length, 1);
  });

  it('in / not_in operators', () => {
    assert.deepEqual(engine.validate({ env: { in: ['dev', 'staging'] } }, { env: 'dev' }), []);
    assert.equal(engine.validate({ env: { in: ['dev', 'staging'] } }, { env: 'prod' }).length, 1);
    assert.deepEqual(engine.validate({ env: { not_in: ['prod'] } }, { env: 'dev' }), []);
    assert.equal(engine.validate({ env: { not_in: ['prod'] } }, { env: 'prod' }).length, 1);
  });

  it('combined operators on one field (min + max)', () => {
    const c = { amount: { min: 10, max: 100 } };
    assert.deepEqual(engine.validate(c, { amount: 50 }), []);
    assert.equal(engine.validate(c, { amount: 5 }).length, 1);
    assert.equal(engine.validate(c, { amount: 500 }).length, 1);
  });

  it('rejects an unknown operator (unknown_constraint_operator)', () => {
    assert.throws(
      () => engine.validate({ x: { gt: 5 } } as never, { x: 10 }),
      (e: unknown) => (e as { code?: string }).code === 'unknown_constraint_operator',
    );
  });

  it('reports every violating field', () => {
    const v = engine.validate({ a: { max: 1 }, b: 'x' }, { a: 5, b: 'y' });
    assert.equal(v.length, 2);
  });
});

describe('constraint engine - intersect (narrow, never widen)', () => {
  it('two maxes -> the smaller; two mins -> the larger', () => {
    assert.deepEqual(engine.intersect({ a: { max: 100 } }, { a: { max: 50 } }), { a: { max: 50 } });
    assert.deepEqual(engine.intersect({ a: { min: 10 } }, { a: { min: 20 } }), { a: { min: 20 } });
  });

  it('combines ranges across both sides', () => {
    assert.deepEqual(engine.intersect({ a: { max: 100 } }, { a: { min: 10 } }), { a: { min: 10, max: 100 } });
  });

  it('in is intersected; not_in is unioned', () => {
    assert.deepEqual(
      engine.intersect({ a: { in: ['x', 'y', 'z'] } }, { a: { in: ['y', 'z', 'w'] } }),
      { a: { in: ['y', 'z'] } },
    );
    const r = engine.intersect({ a: { not_in: ['x'] } }, { a: { not_in: ['y'] } });
    assert.deepEqual([...((r.a as { not_in: string[] }).not_in)].sort(), ['x', 'y']);
  });

  it('fields present on only one side are kept', () => {
    assert.deepEqual(engine.intersect({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  });

  it('an exact value is narrower than a satisfying operator', () => {
    assert.deepEqual(engine.intersect({ a: 50 }, { a: { max: 100 } }), { a: 50 });
  });

  it('throws on conflicting constraints', () => {
    assert.throws(() => engine.intersect({ a: 5 }, { a: 10 }));
    assert.throws(() => engine.intersect({ a: 500 }, { a: { max: 100 } }));
  });
});

describe('constraint engine - properties', () => {
  it('intersection never widens: a value valid under intersect(a,b) is valid under both a and b', () => {
    const range = fc.record({
      min: fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }),
      max: fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(range, range, fc.integer({ min: -100, max: 100 }), (a, b, value) => {
        const merged = engine.intersect({ f: a as never }, { f: b as never });
        if (engine.validate(merged, { f: value }).length !== 0) {
          return true; // value fails the intersection -> nothing to prove
        }
        // If it passes the intersection, it must pass both inputs.
        return (
          engine.validate({ f: a as never }, { f: value }).length === 0 &&
          engine.validate({ f: b as never }, { f: value }).length === 0
        );
      }),
    );
  });
});
