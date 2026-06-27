'use strict';
/**
 * Operator-facing agent metadata: a human name + description for the registry.
 * NOT part of the AAP wire protocol -- purely for visibility ("which agent does what").
 * Treat as untrusted display data (escape on render).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('agents', {
    name: { type: 'text' },
    description: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('agents', ['name', 'description']);
};
