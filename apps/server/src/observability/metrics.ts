/**
 * Metrics — token + latency telemetry surfaced on the dashboard (system latency, token cost per tool).
 * In-process aggregation; `snapshot()` renders it for `GET /metrics`.
 */
export interface LatencyStat {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export interface TokenStat {
  calls: number;
  totalTokens: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  latency: Record<string, LatencyStat>;
  tokensByTool: Record<string, TokenStat>;
}

export interface Metrics {
  recordLatency(route: string, ms: number): void;
  recordTokenEstimate(tool: string, tokens: number): void;
  incrementCounter(name: string, labels?: Record<string, string>): void;
  snapshot(): MetricsSnapshot;
}

/** Build the default in-memory metrics sink. */
export function createMetrics(): Metrics {
  const counters = new Map<string, number>();
  const latency = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  const tokens = new Map<string, { calls: number; totalTokens: number }>();

  return {
    recordLatency(route, ms) {
      const stat = latency.get(route) ?? { count: 0, totalMs: 0, maxMs: 0 };
      stat.count += 1;
      stat.totalMs += ms;
      stat.maxMs = Math.max(stat.maxMs, ms);
      latency.set(route, stat);
    },
    recordTokenEstimate(tool, count) {
      const stat = tokens.get(tool) ?? { calls: 0, totalTokens: 0 };
      stat.calls += 1;
      stat.totalTokens += count;
      tokens.set(tool, stat);
    },
    incrementCounter(name, labels) {
      const key = labels
        ? `${name}{${Object.entries(labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')}}`
        : name;
      counters.set(key, (counters.get(key) ?? 0) + 1);
    },
    snapshot() {
      const counterObj: Record<string, number> = {};
      for (const [k, v] of counters) {
        counterObj[k] = v;
      }
      const latencyObj: Record<string, LatencyStat> = {};
      for (const [route, s] of latency) {
        latencyObj[route] = {
          count: s.count,
          totalMs: s.totalMs,
          avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
          maxMs: s.maxMs,
        };
      }
      const tokenObj: Record<string, TokenStat> = {};
      for (const [tool, s] of tokens) {
        tokenObj[tool] = s;
      }
      return { counters: counterObj, latency: latencyObj, tokensByTool: tokenObj };
    },
  };
}
