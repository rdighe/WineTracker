/** The front door: a landing page with live data for visitors, an overview of your wine for the signed in. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RangeColumns } from '../components/charts';
import { Page } from '../components/Layout';
import { SearchBox } from '../components/SearchBox';
import { Button, ErrorText, Icon, Loading, Stars, Stat, WinePhoto, type IconName } from '../components/ui';
import { api } from '../lib/api';
import { APP_NAME, BRAND } from '../lib/config';
import { change, dollars, dollarsShort, recStyleToWine, shortDate, wineStyleOf, wineTitle } from '../lib/format';
import { startGoogleSignIn, useSession } from '../lib/session';
import { cellarOf, tastedOf, useMine } from '../lib/store';
import type { Recommendation } from '../lib/types';
import { useAsync } from '../lib/useAsync';

export function Home() {
  return useSession() ? <Overview /> : <Landing />;
}

/** A real wine from the catalog, to show what a price dossier looks like. */
const SAMPLE_WINE = 75021; // Ridge, Monte Bello

function Landing() {
  const sample = useAsync(() => api.wine(SAMPLE_WINE), []);
  const vintages = (sample.data?.prices ?? []).filter((p) => /^\d{4}$/.test(p.vintage_key)).sort((a, b) => Number(a.vintage_key) - Number(b.vintage_key)).slice(-10);
  const all = sample.data?.prices.find((p) => p.vintage_key === '*');
  return (
    <Page title={BRAND} search={false}>
      <section className="hero">
        <div>
          <h1>Know what a wine is <em>worth</em>, what you like, and what to order.</h1>
          <p className="lead">
            Prices from US wine shops, every vintage side by side, what you paid against what it's worth now, and
            restaurant wine lists ranked for your taste before you sit down. The desk companion to the {APP_NAME} iPhone app.
          </p>
          <SearchBox placeholder="Look up any wine — try “Ridge Monte Bello”" />
          <div className="row wrap" style={{ marginTop: 'var(--space-5)' }}>
            <Button size="lg" onClick={() => startGoogleSignIn('/')}>Sign in with Google</Button>
            <Link className="btn btn-secondary btn-lg" to="/prices">Explore prices</Link>
          </div>
        </div>
        {sample.data && all ? (
          <Link to={`/wines/${SAMPLE_WINE}`} className="card fade-up" aria-label="Open the sample price dossier">
            <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
              <WinePhoto uri={sample.data.wine.image_url} style={wineStyleOf(sample.data.wine.colour)} className="photo-thumb" />
              <div className="stack" style={{ gap: 2 }}>
                <span className="t-label">A live price dossier</span>
                <span className="t-section">{wineTitle(sample.data.wine.display_name, sample.data.wine.sub_region)}</span>
                <span className="t-foot">{all.n_merchants} shops · per 750 ml</span>
              </div>
              <span className="t-figure-lg num" style={{ marginLeft: 'auto' }}>{dollars(all.median_cents)}</span>
            </div>
            <RangeColumns label="Price by vintage" items={vintages.map((v) => ({ key: v.vintage_key, median: v.median_cents, lo: v.p10_cents, hi: v.p90_cents }))} format={dollarsShort} height={180} />
            <span className="t-foot">Every vintage: the median price and the middle 80% of shops. <span className="link">Open the dossier →</span></span>
          </Link>
        ) : <div className="skeleton" style={{ height: 300 }} />}
      </section>

      <section className="grid grid-4">
        <Feature icon="chart" title="Price explorer" to="/prices">Market price, the range across shops, price over time, and every offer — for any vintage.</Feature>
        <Feature icon="list" title="Wine lists, before you go" to="/lists">Drop a restaurant's PDF list. See what fits your taste and the markup on every bottle.</Feature>
        <Feature icon="bottle" title="Your cellar, valued">What you paid against what it's worth now, bottle by bottle. Export it for insurance.</Feature>
        <Feature icon="sparkle" title="Your palate, charted">What you rate highest by grape and place, where price stops buying pleasure, and a sommelier card.</Feature>
      </section>

      <section className="card">
        <h2 className="t-section">Phone at the table, {BRAND} at your desk</h2>
        <div className="compare">
          <div className="stack">
            <span className="row t-label"><Icon name="phone" size={16} /> {APP_NAME} for iPhone</span>
            <ul>
              <li>Scan a label, or a whole lineup of bottles at once</li>
              <li>Snap the wine list at the table and get your best picks</li>
              <li>Log a tasting with a rating and notes in two taps</li>
              <li>Shops near you that have it, or ship to your state</li>
            </ul>
          </div>
          <div className="stack">
            <span className="row t-label"><Icon name="chart" size={16} /> {BRAND} on the web</span>
            <ul>
              <li>Research prices across every vintage and every shop</li>
              <li>Plan dinner from the restaurant's PDF list, with markups</li>
              <li>A sortable ledger of your cellar, valued, with CSV export</li>
              <li>A palate report, a printable sommelier card, and Vivino import</li>
            </ul>
          </div>
        </div>
        <p className="t-foot">One account: everything you log on the phone is here, and the other way round.</p>
      </section>
    </Page>
  );
}

function Feature({ icon, title, children, to }: { icon: IconName; title: string; children: string; to?: string }) {
  const body = (
    <div className="card feature" style={{ height: '100%' }}>
      <span className="icon-badge"><Icon name={icon} size={20} /></span>
      <span className="t-section">{title}</span>
      <span className="t-foot">{children}</span>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Overview() {
  const mine = useMine();
  const recs = useAsync(() => api.recommendations({ limit: 8 }), []);
  const cellar = cellarOf(mine.tastings);
  const tasted = tastedOf(mine.tastings);

  const s = useMemo(() => {
    const bottles = cellar.reduce((n, t) => n + (t.bottles ?? 1), 0);
    const worth = cellar.reduce((n, t) => n + (t.market_now_cents ?? 0) * (t.bottles ?? 1), 0);
    const priced = cellar.filter((t) => t.paid_750_cents && t.market_now_cents);
    const cost = priced.reduce((n, t) => n + t.paid_750_cents! * (t.bottles ?? 1), 0);
    const value = priced.reduce((n, t) => n + t.market_now_cents! * (t.bottles ?? 1), 0);
    const year = String(new Date().getFullYear());
    const movers = priced.map((t) => ({ t, pct: (t.market_now_cents! - t.paid_750_cents!) / t.paid_750_cents! })).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 5);
    return { bottles, worth, cost, value, movers, thisYear: tasted.filter((t) => t.tasted_on?.startsWith(year)).length };
  }, [cellar, tasted]);
  const gain = change(s.cost, s.value);

  if (mine.error && !mine.tastings) return <Page title="Overview"><ErrorText error={mine.error} /></Page>;
  if (!mine.tastings) return <Page title="Overview"><Loading /></Page>;

  return (
    <Page title="Overview" action={<Link className="btn btn-primary" to="/lists"><Icon name="list" size={17} />Plan a dinner</Link>}>
      <section className="card">
        <div className="grid grid-4">
          <Stat label="Cellar worth now" value={dollars(s.worth)} delta={gain?.text} deltaDir={gain?.dir} hint={`${s.bottles} bottles`} />
          <Stat label="Wines in the cellar" value={cellar.length} hint={<Link className="link" to="/cellar">Open the ledger</Link>} />
          <Stat label={`Tastings in ${new Date().getFullYear()}`} value={s.thisYear} hint={`${tasted.length} in all`} />
          <Stat label="Saved to try" value={mine.saved?.length ?? 0} hint={<Link className="link" to="/saved">See prices</Link>} />
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h3 className="t-section">Biggest movers in your cellar</h3><span className="t-foot">market now against what you paid</span></div>
          {s.movers.length ? (
            <div className="stack" style={{ gap: 0 }}>
              {s.movers.map(({ t }) => {
                const c = change(t.paid_750_cents, t.market_now_cents);
                return (
                  <Link key={t.tasting_id} to={`/wines/${t.wine_id}`} className="mini-row">
                    <span className={`dot ${wineStyleOf(t.colour, t.wine_type)}`} />
                    <span className="name">{wineTitle(t.display_name, t.sub_region)} <span className="faint">{t.vintage_key ?? 'NV'}</span></span>
                    <span className={`num ${c?.dir === 'up' ? 'up' : c?.dir === 'down' ? 'down' : ''}`} style={{ fontWeight: 600 }}>{c?.text}</span>
                  </Link>
                );
              })}
            </div>
          ) : <p className="muted">Add what you paid for cellar bottles to see how they've moved.</p>}
        </section>
        <section className="card">
          <div className="card-head"><h3 className="t-section">Lately</h3><Link className="link t-foot" to="/tasted">All tastings</Link></div>
          {tasted.length ? (
            <div className="stack" style={{ gap: 0 }}>
              {[...tasted].sort((a, b) => b.tasted_on.localeCompare(a.tasted_on)).slice(0, 5).map((t) => (
                <Link key={t.tasting_id} to={`/wines/${t.wine_id}`} className="mini-row">
                  <span className={`dot ${wineStyleOf(t.colour, t.wine_type)}`} />
                  <span className="name">{wineTitle(t.display_name, t.sub_region)} <span className="faint">{t.vintage_key ?? 'NV'}</span></span>
                  <Stars rating={t.rating} />
                  <span className="faint t-foot">{shortDate(t.tasted_on)}</span>
                </Link>
              ))}
            </div>
          ) : <p className="muted">Nothing logged yet. Search a wine above and log it, or use the iPhone app at the table.</p>}
        </section>
      </div>

      <section className="stack">
        <div className="card-head"><h3 className="t-section">For you</h3><Link className="link t-foot" to="/discover">Find more</Link></div>
        {recs.data?.mode === 'profile' ? <RecGrid items={recs.data.items.slice(0, 8)} /> : recs.data?.mode === 'locked' ? (
          <p className="muted">Rate {recs.data.needed - recs.data.rated} more {recs.data.needed - recs.data.rated === 1 ? 'wine' : 'wines'} to get picks for your taste.</p>
        ) : recs.error ? <ErrorText error={recs.error} /> : <div className="skeleton" style={{ height: 200 }} />}
      </section>
    </Page>
  );
}

export function RecGrid({ items }: { items: Recommendation[] }) {
  return (
    <div className="wine-grid">
      {items.map((r, i) => (
        <Link key={r.wineId} to={`/wines/${r.wineId}`} className="wine-card fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
          <WinePhoto uri={r.imageUrl} style={recStyleToWine(r.style)} />
          <div className="body">
            <span className="t-wine-cell" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.displayName}</span>
            <span className="t-foot">{r.region || r.country}</span>
            <span className="row between"><span className="t-figure">{dollars(r.medianCents)}</span><span className="t-foot">{r.nMerchants} {r.nMerchants === 1 ? 'shop' : 'shops'}</span></span>
            {r.reasons.length ? <span className="reasons">{r.reasons.slice(0, 2).join(' · ')}</span> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}
