import type { SecurityEvent } from '@conduit/core';

/** Unsubscribe handle returned by `subscribe`. */
export type Unsubscribe = () => void;

/**
 * SecurityEventStream — OBSERVER / pub-sub.
 *
 * Pillars publish security-relevant events (jti replay, token confusion, signature failures, clock-skew
 * rejections, constraint violations, rate-limit hits). The dashboard subscribes over SSE for a live feed.
 * @remarks Stub.
 */
export interface SecurityEventStream {
  publish(event: Omit<SecurityEvent, 'id' | 'createdAt'>): void;
  subscribe(listener: (event: SecurityEvent) => void): Unsubscribe;
}

/** Build an in-process event stream. @remarks Stub. */
export function createSecurityEventStream(): SecurityEventStream {
  throw new Error('createSecurityEventStream not implemented');
}
