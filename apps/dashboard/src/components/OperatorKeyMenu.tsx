import { useEffect, useRef, useState } from 'react';
import { setOperatorKey, useOperatorKey } from '../lib/useOperatorKey';
import { Icon } from './Icon';

/**
 * Persistent top-bar control for the operator host key — the single prerequisite to *doing* anything
 * (register / edit / revoke agents, connections, grants). Surfacing it globally means a newcomer always
 * sees whether they can act and can fix it in one click, instead of discovering the requirement per-view.
 *
 * The key is a SESSION credential held in the browser only (see useOperatorKey); it signs host JWTs
 * in-browser and is never sent to the server.
 */
export function OperatorKeyMenu(): JSX.Element {
  const { key, loaded } = useOperatorKey();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape so the popover behaves like a standard menu.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(): void {
    setDraft(key);
    setOpen((o) => !o);
  }

  function save(): void {
    setOperatorKey(draft.trim());
    setOpen(false);
  }

  return (
    <div className="opkey" ref={ref}>
      <button
        type="button"
        className={loaded ? 'opkey-chip is-loaded' : 'opkey-chip is-empty'}
        onClick={toggle}
        aria-expanded={open}
        title={loaded ? 'Operator key loaded' : 'Set your operator key to make changes'}
      >
        <Icon name="key" size={14} />
        <span>{loaded ? 'Operator key' : 'Set operator key'}</span>
        <span className={loaded ? 'dot dot-ok' : 'dot dot-warn'} />
      </button>

      {open && (
        <div className="opkey-pop" role="dialog" aria-label="Operator host key">
          <div className="opkey-pop-head">
            <strong>Operator host key</strong>
            <span className="muted">
              {loaded ? 'Loaded for this session.' : 'Required to register, edit, or revoke.'}
            </span>
          </div>
          <p className="opkey-pop-help muted">
            Paste the host private JWK from <span className="mono">npm run bootstrap:host</span>. It stays
            in your browser and is never sent to the server.
          </p>
          <textarea
            className="mono opkey-pop-input"
            rows={4}
            value={draft}
            spellCheck={false}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder='{"kty":"OKP","crv":"Ed25519","x":"...","d":"..."}'
          />
          <div className="opkey-pop-actions">
            <button type="button" className="primaryBtn" disabled={!draft.trim()} onClick={save}>
              {loaded ? 'Update key' : 'Save key'}
            </button>
            {loaded && (
              <button
                type="button"
                className="linkBtn danger"
                onClick={() => {
                  setOperatorKey('');
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
            <button type="button" className="linkBtn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
