import { ConduitError, ErrorCode } from '@conduit/core';
import type { ErrorRequestHandler } from 'express';

/**
 * Terminal Express error middleware. Serializes a `ConduitError` to the standard AAP envelope
 * (`{ error, message, ...structured fields }`) with its HTTP status, and maps any unknown error to
 * `internal_error` without leaking internals. Must keep all four params to be treated as an error handler.
 */
export function errorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof ConduitError) {
      res.status(err.httpStatus).json(err.toEnvelope());
      return;
    }
    res.status(500).json({ error: ErrorCode.internalError, message: 'internal error' });
  };
}
