/** Where Google sign-in returns: take the session token from the address and go on. */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { finishSignIn } from '../lib/session';
import { reloadMine } from '../lib/store';

export function AuthReturn() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const next = finishSignIn(location.hash);
      history.replaceState(null, '', '/auth');
      void reloadMine();
      navigate(next, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [navigate]);
  return (
    <main className="content" style={{ margin: '80px auto', maxWidth: 480 }}>
      {error ? (
        <div className="card">
          <h1 className="t-section">Sign-in didn't finish</h1>
          <p className="error">{error}</p>
          <Link className="link" to="/sign-in">Try again</Link>
        </div>
      ) : <div className="progress"><div /></div>}
    </main>
  );
}
