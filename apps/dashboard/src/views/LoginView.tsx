import { useState } from 'react';
import { createDashboardApi } from '../api/client';

const api = createDashboardApi();

/**
 * Login gate for the dashboard. Shown when the gateway reports auth is required and the session is not
 * authenticated. On success the server sets an httpOnly session cookie; we just re-check the session.
 */
export function LoginView({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(username.trim(), password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginWrap">
      <form className="loginCard" onSubmit={(e) => void submit(e)}>
        <div className="loginBrand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">Conduit</div>
            <div className="brand-sub">Infrastructure Gateway</div>
          </div>
        </div>
        <h1 className="loginTitle">Sign in</h1>
        <p className="page-sub">Enter your operator credentials to access the console.</p>

        <label className="field">
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="errorBox">{error}</div>}

        <button type="submit" className="primaryBtn loginBtn" disabled={busy || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
