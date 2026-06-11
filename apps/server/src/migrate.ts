/**
 * Migration runner — dispatches to the configured backend's migration set behind `npm run migrate`.
 * Postgres uses `node-pg-migrate`; other backends ship their own set behind the same command.
 * Migrations also run automatically on server startup.
 * @remarks Stub.
 */
async function main(): Promise<void> {
  throw new Error('migrate runner not implemented');
}

void main();
