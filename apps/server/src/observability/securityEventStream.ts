import { randomUUID } from 'node:crypto';
import type { SecurityEvent } from '@conduit/core';

/** Unsubscribe handle returned by `subscribe`. */
export type Unsubscribe = () => void;

/**
 * SecurityEventStream — OBSERVER / pub-sub.
 *
 * Pillars publish security-relevant events (jti replay, token confusion, signature failures, clock-skew
 * rejections, constraint violations, rate-limit hits). The dashboard subscribes over SSE for a live feed.
 */
export interface SecurityEventStream {
  publish(event: Omit<SecurityEvent, 'id' | 'createdAt'>): void;
  subscribe(listener: (event: SecurityEvent) => void): Unsubscribe;
}

/** Build an in-process event stream. Listener errors are isolated so one bad subscriber can't break others. */
export function createSecurityEventStream(): SecurityEventStream {
  const listeners = new Set<(event: SecurityEvent) => void>();
  return {
    publish(event) {
      const full: SecurityEvent = { ...event, id: randomUUID(), createdAt: new Date() };
      for (const listener of listeners) {
        try {
          listener(full);
        } catch {
          /* isolate a failing subscriber */
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
