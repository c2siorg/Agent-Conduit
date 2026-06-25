import type { NavKey } from './AppShell';
import { Icon } from './Icon';

/**
 * Shown on action views (Agents, Connections) when no operator host key is loaded. The key is set in one
 * place - the Settings tab - so this just points the operator there.
 */
export function OperatorKeyNotice({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  return (
    <div className="notice">
      <span className="noticeIcon">
        <Icon name="key" size={16} />
      </span>
      <div className="noticeBody">
        <strong>No operator host key set.</strong>
        <span className="muted"> Set it in Settings to register, edit, or revoke agents and connections.</span>
      </div>
      <button type="button" className="primaryBtn" onClick={() => onNavigate('settings')}>
        Open Settings
      </button>
    </div>
  );
}
