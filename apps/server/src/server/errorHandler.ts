import { ConduitError, ErrorCode } from '@conduit/core';
import type { SecurityEventType } from '@conduit/core';
import type { ErrorRequestHandler } from 'express';
import type { SecurityEventStream } from '../observability/securityEventStream.js';

/** Map security-relevant error codes onto the security event stream (anomalies only). */
const SECURITY_EVENT_BY_CODE: Partial<Record<string, SecurityEventType>> = {
  [ErrorCode.constraintViolated]: 'constraintViolated',
  [ErrorCode.invalidJwt]: 'signatureInvalid',
  [ErrorCode.agentRevoked]: 'revokedPrincipalDenied',
  [ErrorCode.hostRevoked]: 'revokedPrincipalDenied',
  [ErrorCode.rateLimited]: 'rateLimitExceeded',
  [ErrorCode.limitExceeded]: 'rateLimitExceeded',
};

/**
 * Terminal Express error middleware. Serializes a `ConduitError` to the standard AAP envelope
 * (`{ error, message, ...structured fields }`) with its HTTP status, and maps any unknown error to
 * `internal_error` without leaking internals. Security-relevant failures are also published to the
 * security event stream. Must keep all four params to be treated as an error handler.
 */
export function errorHandler(events?: SecurityEventStream): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ConduitError) {
      const eventType = SECURITY_EVENT_BY_CODE[err.code];
      if (eventType && events) {
        events.publish({
          type: eventType,
          agentId: null,
          hostId: null,
          detail: { code: err.code, path: req.path, message: err.message },
        });
      }
      res.status(err.httpStatus).json(err.toEnvelope());
      return;
    }
    res.status(500).json({ error: ErrorCode.internalError, message: 'internal error' });
  };
}
