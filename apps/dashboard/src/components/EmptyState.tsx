import { Icon } from './Icon';

/**
 * A polished empty / not-yet-available block, optionally with a primary call-to-action so a newcomer
 * always has a clear next step. Renders inside a `.card` wrapper by default (set `bare` to opt out).
 */
export function EmptyState({
  icon,
  title,
  text,
  badge,
  action,
  bare,
}: {
  icon: string;
  title: string;
  text: string;
  badge?: string;
  action?: { label: string; onClick: () => void };
  /** Render without the surrounding card (e.g. when already inside one). */
  bare?: boolean;
}): JSX.Element {
  const body = (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <div className="empty-title">{title}</div>
      <p className="empty-text">{text}</p>
      {badge && <span className="badge badge-accent">{badge}</span>}
      {action && (
        <button type="button" className="primaryBtn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
  return bare ? body : <div className="card">{body}</div>;
}
