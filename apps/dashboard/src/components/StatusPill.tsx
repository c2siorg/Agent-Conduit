const MAP: Record<string, { cls: string; label: string }> = {
  active: { cls: 'pill-ok', label: 'Active' },
  pending: { cls: 'pill-warn', label: 'Pending' },
  expired: { cls: 'pill-warn', label: 'Expired' },
  revoked: { cls: 'pill-danger', label: 'Revoked' },
  rejected: { cls: 'pill-danger', label: 'Rejected' },
  claimed: { cls: 'pill-claimed', label: 'Claimed' },
};

/** Compact status indicator: a colored dot + label, color-coded by lifecycle state. */
export function StatusPill({ status, label }: { status: string; label?: string }): JSX.Element {
  const m = MAP[status] ?? { cls: 'pill-info', label: status };
  return (
    <span className={`pill ${m.cls}`}>
      <span className="pillDot" />
      {label ?? m.label}
    </span>
  );
}
