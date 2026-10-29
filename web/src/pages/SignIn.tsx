/** Sign in: Google, plus a name-only sign-in when the API is a local development server. */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, ErrorText } from '../components/ui';
import { api } from '../lib/api';
import { APP_NAME } from '../lib/config';
import { signInDev, startGoogleSignIn } from '../lib/session';
import { reloadMine } from '../lib/store';
import { useAsync } from '../lib/useAsync';

export function SignIn() {
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const health = useAsync(() => api.health(), []);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const methods = health.data?.signIn ?? ['google'];
  return (
    <Page title="Sign in" search={false}>
      <section className="card" style={{ maxWidth: 480 }}>
        <p className="t-body">Use the Google account you use in the {APP_NAME} iPhone app, and your cellar and tastings are here.</p>
        {methods.includes('google') ? <Button size="lg" onClick={() => startGoogleSignIn(next)}>Continue with Google</Button> : null}
        {methods.includes('dev') ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); try { signInDev(name); void reloadMine(); navigate(next); } catch (err) { setError(err); } }}>
            <span className="t-label">Development sign-in (local servers only)</span>
            <div className="row"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Any name" /><Button type="submit" variant="secondary">Sign in</Button></div>
          </form>
        ) : null}
        <ErrorText error={error ?? health.error} />
      </section>
    </Page>
  );
}
