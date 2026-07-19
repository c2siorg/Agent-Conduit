/* Connection health: persist the last credential-test result so the vault can show it at a glance. */
exports.up = (pgm) => {
  pgm.addColumns('connections', {
    last_test_ok: { type: 'boolean' },
    last_test_at: { type: 'timestamptz' },
    last_test_detail: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('connections', ['last_test_ok', 'last_test_at', 'last_test_detail']);
};
