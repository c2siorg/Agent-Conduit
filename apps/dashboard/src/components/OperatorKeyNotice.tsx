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
        <span className="muted">
          {' '}
          Use <b>Set operator key</b> in the top bar to register, edit, or revoke — or set it in Settings.
        </span>
      </div>
      <button type="button" className="linkBtn" onClick={() => onNavigate('settings')}>
        Open Settings
      </button>
    </div>
  );
}
