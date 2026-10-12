import { useId, useRef, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, LockKeyhole, LogOut } from 'lucide-react';

export default function AiAccess({ health, onRefresh }) {
  const id = useId();
  const errorRef = useRef(null);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!health.authRequired) return null;
  async function submit(event, logout = false) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/auth/${logout ? 'logout' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logout ? {} : { password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in is unavailable. Try again.');
      setPassword('');
      setVisible(false);
      await onRefresh();
    } catch (error) {
      setError(error.message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ai-access" aria-label="AI access" aria-busy={busy}>
      <strong>
        <LockKeyhole size={17} />{' '}
        {health.authenticated ? 'AI access unlocked' : 'Protected AI access'}
      </strong>
      {error && (
        <p className="form-error" role="alert" tabIndex={-1} ref={errorRef} id={`${id}-error`}>
          {error}
        </p>
      )}
      {!health.authConfigured ? (
        <p>AI access is awaiting setup by the app owner. Manual investigation is available.</p>
      ) : health.authenticated ? (
        <>
          <p>Your session lasts up to 12 hours, or until the server restarts.</p>
          {Number.isInteger(health.dailyRemaining) && (
            <p>
              <b>
                {health.dailyRemaining} of {health.dailyLimit}
              </b>{' '}
              AI requests remaining on this server today. A Findwhere search can use up to four.
              Resets at 00:00 UTC. Failed provider requests count too.
            </p>
          )}
          <p className="subtle">
            Usage limits can reset when hosting storage is cleared. The app owner should also
            monitor provider spending.
          </p>
          <button
            className="button secondary full-width"
            disabled={busy}
            onClick={(event) => submit(event, true)}
          >
            <LogOut size={16} /> {busy ? 'Signing out…' : 'Lock AI access'}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p>
            Enter the access password provided by the app owner. Signing in does not send your
            photo.
          </p>
          <label className="notes-label" htmlFor={`${id}-password`}>
            AI access password
          </label>
          <div className="password-field">
            <input
              id={`${id}-password`}
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={200}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={visible ? 'Hide password' : 'Show password'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <button className="button secondary full-width" disabled={busy || !password}>
            {busy ? (
              <>
                <LoaderCircle size={16} className="spin" /> Signing in…
              </>
            ) : (
              <>
                <LockKeyhole size={16} /> Unlock AI access
              </>
            )}
          </button>
        </form>
      )}
    </section>
  );
}
