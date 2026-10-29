/** The price explorer's front page: search the catalog, and the wines this browser looked at lately. */
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { SearchBox } from '../components/SearchBox';
import { WinePhoto } from '../components/ui';
import { recentlyViewed } from '../lib/recent';
import { wineStyleOf } from '../lib/format';

export function Prices() {
  const recent = recentlyViewed();
  return (
    <Page title="Price explorer" search={false}>
      <section className="card lists-intro">
        <div className="stack-lg" style={{ maxWidth: 680 }}>
          <h2 className="t-wine-display">What's it worth?</h2>
          <p className="t-body muted">
            Look up any wine for its market price per 750 ml: the median across US shops, the range most shops charge,
            how it has moved, how every vintage compares, and each shop's current offer.
          </p>
          <SearchBox placeholder="Producer and wine, e.g. Tempier Bandol rosé" autoFocus />
        </div>
      </section>
      {recent.length ? (
        <section className="stack">
          <h3 className="t-section">Looked at lately</h3>
          <div className="wine-grid">
            {recent.map((r) => (
              <Link key={r.id} to={`/wines/${r.id}`} className="wine-card">
                <WinePhoto uri={r.image} style={wineStyleOf(r.colour)} />
                <div className="body"><span className="t-wine-cell">{r.name}</span></div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <section className="grid grid-3">
        <div className="card"><span className="t-section">Honest numbers</span><span className="t-foot">Every price is per 750 ml and says how many shops it's from and how recent it is. Old prices are marked, not hidden.</span></div>
        <div className="card"><span className="t-section">Updated daily</span><span className="t-foot">Shop catalogs are read every day; wines people save or taste are re-checked first.</span></div>
        <div className="card"><span className="t-section">Your prices stay yours</span><span className="t-foot">What you paid is kept with your tastings. It never moves the market price.</span></div>
      </section>
    </Page>
  );
}
