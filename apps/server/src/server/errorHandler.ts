import type { ErrorRequestHandler } from 'express';

/**
 * errorHandler — terminal Express error middleware.
 *
 * Serializes a `ConduitError` to the standard AAP envelope (`{ error, message, …structured fields }`),
 * sets the carried HTTP status, and maps any UNKNOWN error to `internal_error` without leaking internals.
 * @remarks Stub.
 */
export function errorHandler(): ErrorRequestHandler {
  throw new Error('errorHandler not implemented');
}
