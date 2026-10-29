/**
 * The site's frame: a sidebar on surface-sunken with the wordmark and the
 * sections, and each page's sticky glass top bar with its title, the wine
 * search and the page's one action.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { APP_NAME, BRAND } from '../lib/config';
import { startGoogleSignIn, useSession } from '../lib/session';
import { cellarOf, tastedOf, useMine } from '../lib/store';
import { SearchBox } from './SearchBox';
import { Button, Icon, type IconName } from './ui';

const NavCtx = createContext<() => void>(() => {});

function Side({ to, icon, label, count, end }: { to: string; icon: IconName; label: string; count?: number | null; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
      <Icon name={icon} />
      {label}
      {count ? <span className="count">{count.toLocaleString('en-US')}</span> : null}
    </NavLink>
  );
}

export function Layout() {
  const session = useSession();
  const mine = useMine();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);
  const bottles = cellarOf(mine.tastings).reduce((n, t) => n + (t.bottles ?? 1), 0);

  return (
    <NavCtx.Provider value={() => setNavOpen((o) => !o)}>
      <div className={`shell ${navOpen ? 'nav-open' : ''}`} onClick={(e) => navOpen && e.target === e.currentTarget && setNavOpen(false)}>
        <nav className="sidebar" aria-label="Sections">
          <NavLink to="/" className="wordmark" aria-label={`${BRAND} home`}>{BRAND}</NavLink>
          <div className="side-group">
            <Side to="/" end icon="home" label={session ? 'Overview' : 'Home'} />
            <Side to="/prices" icon="search" label="Price explorer" />
            <Side to="/lists" icon="list" label="Wine lists" />
          </div>
          {session ? (
            <>
              <div className="side-group">
                <span className="t-label">Yours</span>
                <Side to="/cellar" icon="bottle" label="Cellar" count={bottles || null} />
                <Side to="/tasted" icon="glass" label="Tasted" count={tastedOf(mine.tastings).length || null} />
                <Side to="/saved" icon="bookmark" label="Saved" count={mine.saved?.length || null} />
                <Side to="/palate" icon="chart" label="Palate report" />
                <Side to="/discover" icon="sparkle" label="For you" />
              </div>
              <div className="side-group">
                <Side to="/settings" icon="gear" label="Import & settings" />
              </div>
            </>
          ) : null}
          <div className="side-foot">
            {!session ? <Button onClick={() => startGoogleSignIn()}>Sign in with Google</Button> : null}
            <div className="side-app">
              <span className="row t-section"><Icon name="phone" size={16} /> {APP_NAME} for iPhone</span>
              <span className="t-foot">Scan labels and log tastings at the table. Everything shows up here.</span>
            </div>
          </div>
        </nav>
        <div className="main">
          <Outlet />
          <ScrollRestoration />
        </div>
      </div>
    </NavCtx.Provider>
  );
}

/** A page: its top bar (title, counts, search, action) and content. */
export function Page({ title, sub, action, children, wide, search = true }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; wide?: boolean; search?: boolean }) {
  const toggleNav = useContext(NavCtx);
  useEffect(() => {
    document.title = typeof title === 'string' ? `${title} · ${BRAND}` : BRAND;
  }, [title]);
  return (
    <>
      <header className="topbar">
        <Button variant="secondary" className="menu-btn btn-icon" aria-label="Menu" onClick={toggleNav} icon="menu" />
        <div style={{ minWidth: 0 }}>
          <h1 className="t-title">{title}</h1>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        <span className="topbar-spacer" />
        {search ? <SearchBox /> : null}
        {action}
      </header>
      <main className={`content ${wide ? 'wide' : ''}`}>{children}</main>
    </>
  );
}
