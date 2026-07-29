import { useSecurityEvents, type SecurityEventItem } from '../lib/useSecurityEvents';

/** Map a security event type to a severity + human label. */
const EVENT_META: Record<string, { sev: 'high' | 'med' | 'low'; label: string }> = {
  jtiReplayDetected: { sev: 'high', label: 'Replay detected' },
  tokenConfusion: { sev: 'high', label: 'Token confusion' },
  signatureInvalid: { sev: 'high', label: 'Invalid signature' },
  revokedPrincipalDenied: { sev: 'high', label: 'Revoked principal denied' },
  constraintViolated: { sev: 'med', label: 'Constraint violated' },
  rateLimitExceeded: { sev: 'med', label: 'Rate limit exceeded' },
  clockSkewRejected: { sev: 'low', label: 'Clock skew rejected' },
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function EventRow({ e }: { e: SecurityEventItem }): JSX.Element {
  const meta = EVENT_META[e.type] ?? { sev: 'low' as const, label: e.type };
  const path = typeof e.detail['path'] === 'string' ? (e.detail['path'] as string) : '';
  return (
    <div className="feedRow">
      <span className={`sevDot sev-${meta.sev}`} />
      <span className="feedLabel">{meta.label}</span>
      {path && <span className="feedPath mono">{path}</span>}
      <span className="feedTime mono">{time(e.createdAt)}</span>
    </div>
  );
}

/** Live security console: a real-time, color-coded feed of security events over SSE. */
export function SecurityFeed(): JSX.Element {
  const { events, connected } = useSecurityEvents(60);
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Live Security Events</span>
        <span className={connected ? 'sys sys-ok' : 'sys sys-bad'}>
          <span className="dot" />
          {connected ? 'Streaming' : 'Disconnected'}
        </span>
      </div>
      <div className="feed">
        {events.length === 0 ? (
          <p className="muted feedEmpty">
            {connected ? 'Listening — security anomalies (replay, constraint denials, rate limits) appear here in real time.' : 'Connecting to the event stream...'}
          </p>
        ) : (
          events.map((e) => <EventRow key={e.id} e={e} />)
        )}
      </div>
    </div>
  );
}
