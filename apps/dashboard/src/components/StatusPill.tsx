/** Maps a lifecycle status → a design-token pill class. */
const STATUS_CLASS: Record<string, string> = {
  active: 'pillActive',
  pending: 'pillPending',
  expired: 'pillPending',
  revoked: 'pillRevoked',
  rejected: 'pillRevoked',
  claimed: 'pillClaimed',
};

/** StatusPill — compact status indicator used across the agent/connection tables. */
export function StatusPill({ status }: { status: string }): JSX.Element {
  const cls = STATUS_CLASS[status] ?? 'pillPending';
  return <span className={`pill ${cls}`}>{status}</span>;
}
