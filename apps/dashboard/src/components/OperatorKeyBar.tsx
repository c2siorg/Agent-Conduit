import { useState } from 'react';
import { Icon } from './Icon';

/**
 * Compact control for the operator host key. The raw JWK textarea only appears while setting it; once
 * loaded it collapses to a status chip. The key is a session credential held in browser memory only.
 */
export function OperatorKeyBar({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const loaded = value.trim().length > 0;

  if (editing) {
    return (
      <div className="keybar keybarOpen">
        <label className="field">
          <span>Operator host key (JWK) - from `npm run bootstrap:host`. Stays in your browser only.</span>
          <textarea
            className="mono"
            rows={4}
            value={draft}
            spellCheck={false}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder='{"kty":"OKP","crv":"Ed25519","x":"...","d":"..."}'
          />
        </label>
        <div className="keybarActions">
          <button
            type="button"
            className="primaryBtn"
            onClick={() => {
              onChange(draft.trim());
              setEditing(false);
            }}
          >
            Save key
          </button>
          <button type="button" className="linkBtn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="keybar">
      <span className="keybarIcon">
        <Icon name="key" size={16} />
      </span>
      {loaded ? (
        <span className="keybarStatus">
          <span className="dot dot-ok" /> Operator key loaded
        </span>
      ) : (
        <span className="muted">No operator host key set - required to register, edit, or revoke agents.</span>
      )}
      <div className="keybarActions">
        <button
          type="button"
          className="linkBtn"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {loaded ? 'Change' : 'Set key'}
        </button>
        {loaded && (
          <button type="button" className="linkBtn" onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
