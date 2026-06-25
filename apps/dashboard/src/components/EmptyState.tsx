import { Icon } from './Icon';

/** A polished empty / not-yet-available block. Wrap in a `.card` when used as a full panel. */
export function EmptyState({
  icon,
  title,
  text,
  badge,
}: {
  icon: string;
  title: string;
  text: string;
  badge?: string;
}): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <div className="empty-title">{title}</div>
      <p className="empty-text">{text}</p>
      {badge && <span className="badge badge-accent">{badge}</span>}
    </div>
  );
}
