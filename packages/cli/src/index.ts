#!/usr/bin/env node
/**
 * Conduit admin CLI entrypoint.
 *
 * Planned command groups (each maps to documented admin endpoints — never raw DB access):
 *   connection   register | list | rotate | re-authenticate
 *   agent        list | revoke | rotate-key | logs
 *   host         list | revoke | rotate-key
 *   migrate      run versioned migrations for the selected backend
 *   audit        query | export
 *
 * @remarks Scaffold — command routing not implemented.
 */
function main(argv: string[]): void {
  throw new Error(`conduit CLI not implemented (argv: ${argv.slice(2).join(' ')})`);
}

main(process.argv);
