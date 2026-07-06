import { Router } from 'express';
import type { Metrics } from '../observability/metrics.js';
import type { SecurityEventStream } from '../observability/securityEventStream.js';

export interface ObservabilityRoutesDeps {
  events: SecurityEventStream;
  metrics: Metrics;
}

/**
 * Observability routes:
 *   GET /events  - live security event stream over SSE (the dashboard subscribes for a real-time feed).
 *   GET /metrics - token + latency telemetry snapshot.
 */
export function observabilityRoutes(deps: ObservabilityRoutesDeps): Router {
  const router = Router();

  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    const unsubscribe = deps.events.subscribe((event) => {
      res.write(`event: security\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  router.get('/metrics', (_req, res) => {
    res.json(deps.metrics.snapshot());
  });

  return router;
}
