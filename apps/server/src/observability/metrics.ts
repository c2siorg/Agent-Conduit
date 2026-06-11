/**
 * Metrics — token + latency telemetry surfaced on the dashboard (system latency, token cost per tool).
 * @remarks Stub.
 */
export interface Metrics {
  recordLatency(route: string, ms: number): void;
  recordTokenEstimate(tool: string, tokens: number): void;
  incrementCounter(name: string, labels?: Record<string, string>): void;
}

/** Build the default metrics sink. @remarks Stub. */
export function createMetrics(): Metrics {
  throw new Error('createMetrics not implemented');
}
