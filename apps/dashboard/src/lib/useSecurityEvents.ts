import { useEffect, useState } from 'react';

/** A security event delivered over the SSE stream (`GET /events`). */
export interface SecurityEventItem {
  id: string;
  type: string;
  agentId: string | null;
  hostId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * Subscribe to the gateway's live security event stream (SSE). Returns the most recent events (newest
 * first, capped) and the connection state. EventSource reconnects automatically on drop.
 */
export function useSecurityEvents(max = 50): { events: SecurityEventItem[]; connected: boolean } {
  const [events, setEvents] = useState<SecurityEventItem[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('security', (e) => {
      try {
        const item = JSON.parse((e as MessageEvent).data) as SecurityEventItem;
        setEvents((prev) => [item, ...prev].slice(0, max));
      } catch {
        /* ignore malformed frame */
      }
    });
    return () => source.close();
  }, [max]);

  return { events, connected };
}
