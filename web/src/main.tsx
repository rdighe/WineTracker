import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider, useLocation } from 'react-router-dom';
import { Layout, Page } from './components/Layout';
import { Button, Empty } from './components/ui';
import { startGoogleSignIn, useSession } from './lib/session';
import { applyTheme } from './lib/theme';
import { AuthReturn } from './pages/Auth';
import { Discover } from './pages/Discover';
import { Home } from './pages/Home';
import { Ledger } from './pages/Ledger';
import { Lists } from './pages/Lists';
import { Palate } from './pages/Palate';
import { Prices } from './pages/Prices';
import { Saved } from './pages/Saved';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { WinePage } from './pages/WinePage';
import './styles.css';

applyTheme();

/** Pages about your own wine ask you to sign in first. */
function Mine({ title, children }: { title: string; children: ReactNode }) {
  const session = useSession();
  const { pathname } = useLocation();
  if (session) return children;
  return (
    <Page title={title}>
      <div className="card">
        <Empty icon="bottle" title="Sign in to see your wine">
          <p>Your cellar, tastings and palate come from your account — the same one as the iPhone app.</p>
          <Button onClick={() => startGoogleSignIn(pathname)}>Sign in with Google</Button>
        </Empty>
      </div>
    </Page>
  );
}

function NotFound() {
  return (
    <Page title="Not found">
      <div className="card"><Empty icon="search" title="There's nothing at this address"><Link className="link" to="/">Go home</Link></Empty></div>
    </Page>
  );
}

const router = createBrowserRouter([
  { path: '/auth', element: <AuthReturn /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/prices', element: <Prices /> },
      { path: '/wines/:id', element: <WinePage /> },
      { path: '/lists', element: <Lists /> },
      { path: '/lists/:id', element: <Lists /> },
      { path: '/cellar', element: <Mine title="Cellar"><Ledger mode="cellar" /></Mine> },
      { path: '/tasted', element: <Mine title="Tasted"><Ledger mode="tasted" /></Mine> },
      { path: '/saved', element: <Mine title="Saved"><Saved /></Mine> },
      { path: '/palate', element: <Mine title="Palate report"><Palate /></Mine> },
      { path: '/discover', element: <Mine title="For you"><Discover /></Mine> },
      { path: '/settings', element: <Mine title="Import & settings"><Settings /></Mine> },
      { path: '/sign-in', element: <SignIn /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
