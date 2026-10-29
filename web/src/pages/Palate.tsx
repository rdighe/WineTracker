/**
 * Your palate, read from your ratings: what you rate highest by grape, place,
 * producer and style, where price stops buying enjoyment, how often you
 * taste, and a one-page sommelier card to print or paste into a message
 * before dinner.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, Columns, Scatter } from '../components/charts';
import { Page } from '../components/Layout';
import { Button, Empty, ErrorText, Loading, Segmented, Stat } from '../components/ui';
import { api } from '../lib/api';
import { BRAND } from '../lib/config';
import { dollars, dollarsShort, monthLabel, STYLE_NAMES, wineStyleOf, wineTitle, type WineStyle } from '../lib/format';
import { useSession } from '../lib/session';
import { useMine } from '../lib/store';
import type { Tasting } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Dim = 'grape' | 'region' | 'country' | 'producer' | 'style';
const DIMS: { value: Dim; label: string }[] = [
  { value: 'grape', label: 'Grape' }, { value: 'region', label: 'Region' }, { value: 'country', label: 'Country' },
  { value: 'producer', label: 'Producer' }, { value: 'style', label: 'Style' },
];

const BANDS = [
  { lo: 0, hi: 2000, label: 'Under $20' }, { lo: 2000, hi: 4000, label: '$20–$40' }, { lo: 4000, hi: 7500, label: '$40–$75' },
  { lo: 7500, hi: 15000, label: '$75–$150' }, { lo: 15000, hi: Infinity, label: '$150 and up' },
];

function keysFor(t: Tasting, dim: Dim): string[] {
  switch (dim) {
    case 'grape': return t.grape.split(/[,/&]| and /).map((g) => g.trim()).filter((g) => g && g.length < 40);
    case 'region': return [t.sub_region || t.region].filter((r): r is string => Boolean(r) && r !== 'Other');
    case 'country': return [t.country].filter((c) => c && c !== 'Other');
    case 'producer': return [t.producer].filter(Boolean);
    case 'style': return [STYLE_NAMES[wineStyleOf(t.colour, t.wine_type)]];
  }
}

interface Group { key: string; avg: number; n: number }

function groupBy(rated: Tasting[], dim: Dim, min = 2): Group[] {
  const m = new Map<string, { sum: number; n: number }>();
  for (const t of rated) for (const k of keysFor(t, dim)) {
    const g = m.get(k) ?? { sum: 0, n: 0 };
    g.sum += t.rating!;
    g.n += 1;
    m.set(k, g);
  }
  return [...m].map(([key, g]) => ({ key, avg: g.sum / g.n, n: g.n })).filter((g) => g.n >= min);
}

export function Palate() {
  const mine = useMine();
  const session = useSession();
  const [dim, setDim] = useState<Dim>('grape');
  const [printCard, setPrintCard] = useState(false);
  const recs = useAsync(() => api.recommendations({ limit: 1 }), [session?.email]);
  const summary = recs.data?.mode === 'profile' ? recs.data.summary : undefined;

  // One rating per wine and vintage: the latest.
  const rated = useMemo(() => {
    const seen = new Map<string, Tasting>();
    for (const t of mine.tastings ?? []) {
      if (t.rating == null) continue;
      const k = `${t.wine_id}:${t.vintage_key ?? ''}`;
      const cur = seen.get(k);
      if (!cur || cur.tasted_on < t.tasted_on) seen.set(k, t);
    }
    return [...seen.values()];
  }, [mine.tastings]);

  const all = mine.tastings ?? [];
  const avg = rated.length ? rated.reduce((n, t) => n + t.rating!, 0) / rated.length : null;
  const groups = useMemo(() => {
    const min = rated.length >= 25 ? 2 : 1;
    return groupBy(rated, dim, dim === 'style' ? 1 : min).sort((a, b) => b.avg - a.avg || b.n - a.n);
  }, [rated, dim]);
  // Styles with two or more wines lead; one great rosé shouldn't make rosé the favorite.
  const styleGroups = useMemo(() => groupBy(rated, 'style', 1).sort((a, b) => Number(b.n >= 2) - Number(a.n >= 2) || b.avg - a.avg), [rated]);

  const bands = useMemo(() => BANDS.map((b) => {
    const inBand = rated.filter((t) => t.paid_750_cents != null && t.paid_750_cents >= b.lo && t.paid_750_cents < b.hi);
    return { ...b, n: inBand.length, avg: inBand.length ? inBand.reduce((n, t) => n + t.rating!, 0) / inBand.length : 0 };
  }).filter((b) => b.n > 0), [rated]);
  const sweetSpot = useMemo(() => {
    const solid = bands.filter((b) => b.n >= 2);
    if (solid.length < 2) return null;
    const best = Math.max(...solid.map((b) => b.avg));
    return { band: solid.find((b) => b.avg >= best - 0.25)!, best: solid.find((b) => b.avg === best)! };
  }, [bands]);

  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of all) if (t.kind === 'tasted' && t.tasted_on) counts.set(t.tasted_on.slice(0, 7), (counts.get(t.tasted_on.slice(0, 7)) ?? 0) + 1);
    if (!counts.size) return [];
    const now = new Date();
    const out: { key: string; label: string; v: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key, label: monthLabel(key), v: counts.get(key) ?? 0 });
    }
    return out;
  }, [all]);

  const top = (d: Dim, n = 3) => groupBy(rated, d, rated.length >= 12 ? 2 : 1).filter((g) => g.avg >= Math.max(3.5, (avg ?? 0))).sort((a, b) => b.avg - a.avg || b.n - a.n).slice(0, n).map((g) => g.key);
  const bottom = (d: Dim, n = 2) => groupBy(rated, d, 2).filter((g) => g.avg < Math.min(3, (avg ?? 3) - 0.5)).sort((a, b) => a.avg - b.avg).slice(0, n).map((g) => g.key);
  const favorites = [...rated].sort((a, b) => b.rating! - a.rating! || b.tasted_on.localeCompare(a.tasted_on)).slice(0, 5);

  const card = {
    styles: styleGroups.filter((g) => g.avg >= (avg ?? 0) - 0.1).slice(0, 3).map((g) => g.key),
    grapes: top('grape'), regions: top('region'), flavors: summary?.flavors.slice(0, 6) ?? [],
    avoid: [...bottom('grape'), ...bottom('region')].slice(0, 3),
    spend: summary?.priceLowCents && summary.priceHighCents ? `${dollars(summary.priceLowCents)}–${dollars(summary.priceHighCents)} a bottle in shops` : sweetSpot ? `${sweetSpot.band.label} a bottle in shops` : null,
    favorites: favorites.slice(0, 3).map((t) => `${wineTitle(t.display_name, t.sub_region)}${t.vintage_key ? ` ${t.vintage_key}` : ''}`),
  };
  const cardText = [
    `What I like in wine (from ${rated.length} wines I've rated on ${BRAND})`,
    card.styles.length ? `Styles: ${card.styles.join(', ')}` : '',
    card.grapes.length ? `Grapes: ${card.grapes.join(', ')}` : '',
    card.regions.length ? `Places: ${card.regions.join(', ')}` : '',
    card.flavors.length ? `Flavors: ${card.flavors.join(', ')}` : '',
    card.avoid.length ? `Less my thing: ${card.avoid.join(', ')}` : '',
    card.spend ? `Usually: ${card.spend}` : '',
    card.favorites.length ? `Loved lately: ${card.favorites.join('; ')}` : '',
  ].filter(Boolean).join('\n');
  const [copied, setCopied] = useState(false);

  if (mine.error && !mine.tastings) return <Page title="Palate report"><ErrorText error={mine.error} /></Page>;
  if (!mine.tastings) return <Page title="Palate report"><Loading /></Page>;
  if (rated.length < 3) {
    return (
      <Page title="Palate report">
        <div className="card"><Empty icon="chart" title="Rate three wines to see your palate">
          <p>You've rated {rated.length}. Log tastings with a star rating here or in the iPhone app, or <Link className="link" to="/settings">import your Vivino ratings</Link>.</p>
        </Empty></div>
      </Page>
    );
  }

  const print = () => {
    setPrintCard(true);
    setTimeout(() => { window.print(); setPrintCard(false); }, 50);
  };

  return (
    <Page title="Palate report" sub={`From ${rated.length} rated wines`} action={<Button variant="secondary" icon="print" onClick={print}>Print sommelier card</Button>}>
      <div className={printCard ? 'printing-card' : ''}>
        <div className="stack-lg">
          <section className="card somm-card">
            <div className="card-head">
              <div>
                <h3 className="t-section">Sommelier card</h3>
                <span className="t-foot">Hand it over, or paste it into a message to the restaurant before you go.</span>
              </div>
              <div className="row no-print">
                <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(cardText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}>{copied ? 'Copied' : 'Copy as text'}</Button>
              </div>
            </div>
            <dl className="kv somm">
              {card.styles.length ? <><dt>Styles</dt><dd>{card.styles.join(', ')}</dd></> : null}
              {card.grapes.length ? <><dt>Grapes</dt><dd>{card.grapes.join(', ')}</dd></> : null}
              {card.regions.length ? <><dt>Places</dt><dd>{card.regions.join(', ')}</dd></> : null}
              {card.flavors.length ? <><dt>Flavors</dt><dd>{card.flavors.join(', ')}</dd></> : null}
              {card.avoid.length ? <><dt>Less my thing</dt><dd>{card.avoid.join(', ')}</dd></> : null}
              {card.spend ? <><dt>Usually</dt><dd>{card.spend}</dd></> : null}
              {card.favorites.length ? <><dt>Loved lately</dt><dd>{card.favorites.join(' · ')}</dd></> : null}
            </dl>
          </section>

          <section className="card print-hide">
            <div className="grid grid-4">
              <Stat label="Wines rated" value={rated.length} hint={`${all.filter((t) => t.kind === 'tasted').length} tastings logged`} />
              <Stat label="Your average" value={avg!.toFixed(2)} hint="of 5 stars" />
              <Stat label="Favorite style" value={styleGroups[0]?.key ?? '—'} hint={styleGroups[0] ? `${styleGroups[0].avg.toFixed(1)} average over ${styleGroups[0].n}` : undefined} />
              <Stat label="Sweet spot" value={sweetSpot ? sweetSpot.band.label : '—'} hint={sweetSpot ? (sweetSpot.band === sweetSpot.best ? 'where you rate highest' : `rated within a quarter star of ${sweetSpot.best.label}`) : 'note prices paid to see it'} />
            </div>
          </section>

          <div className="grid grid-2 print-hide">
            <section className="card">
              <div className="card-head">
                <h3 className="t-section">What you rate highest</h3>
                <Segmented label="Group by" value={dim} onChange={setDim} options={DIMS} />
              </div>
              {groups.length ? (
                <>
                  <BarList items={groups.slice(0, 10).map((g) => ({ key: g.key, label: dim === 'style' ? <span className="row"><span className={`dot ${styleKey(g.key)}`} />{g.key}</span> : g.key, v: g.avg, note: `${g.n}` }))} max={5} format={(v) => `${v.toFixed(1)}★`} />
                  <p className="t-foot">Average rating, then how many wines it's based on.{rated.length >= 25 && dim !== 'style' ? ' Only groups with two or more wines.' : ''}</p>
                </>
              ) : <p className="muted">Not enough wines with a {dim} yet.</p>}
            </section>
            <section className="card">
              <div className="card-head">
                <h3 className="t-section">Price and pleasure</h3>
                <span className="t-foot">your rating against what you paid, per 750 ml</span>
              </div>
              {rated.some((t) => t.paid_750_cents) ? (
                <>
                  <Scatter
                    label="Rating against price paid"
                    points={rated.filter((t) => t.paid_750_cents).map((t) => ({ id: String(t.tasting_id), x: t.paid_750_cents!, y: t.rating!, style: wineStyleOf(t.colour, t.wine_type), name: wineTitle(t.display_name, t.sub_region) }))}
                    xFormat={dollarsShort}
                  />
                  {sweetSpot ? (
                    <p className="t-foot">
                      You rate wines at <strong style={{ color: 'var(--ink)' }}>{sweetSpot.band.label}</strong> {sweetSpot.band === sweetSpot.best ? 'higher than any other price' : `nearly as high (${sweetSpot.band.avg.toFixed(1)}★) as ${sweetSpot.best.label} (${sweetSpot.best.avg.toFixed(1)}★)`}.
                    </p>
                  ) : null}
                </>
              ) : <p className="muted">Add the price you paid to your tastings to see where your money buys the most enjoyment.</p>}
            </section>
          </div>

          <div className="grid grid-2 print-hide">
            <section className="card">
              <div className="card-head"><h3 className="t-section">Average rating by price paid</h3></div>
              {bands.length ? <BarList items={bands.map((b) => ({ key: b.label, label: b.label, v: b.avg, note: `${b.n}` }))} max={5} format={(v) => `${v.toFixed(1)}★`} /> : <p className="muted">No prices paid yet.</p>}
            </section>
            <section className="card">
              <div className="card-head">
                <h3 className="t-section">Tastings by month</h3>
                <span className="t-foot">last two years</span>
              </div>
              {months.length ? <Columns items={months} label="Tastings logged each month" /> : <p className="muted">No dated tastings yet.</p>}
            </section>
          </div>

          <section className="card flush print-hide">
            <div className="card-head" style={{ padding: 'var(--space-4) var(--space-5)' }}><h3 className="t-section">Your favorites</h3></div>
            <table className="dt">
              <tbody>
                {favorites.map((t) => (
                  <tr key={t.tasting_id}>
                    <td><Link to={`/wines/${t.wine_id}`} className="wine-cell"><span className={`dot ${wineStyleOf(t.colour, t.wine_type)}`} /><span className="name">{wineTitle(t.display_name, t.sub_region)}</span></Link></td>
                    <td className="fit">{t.vintage_key ?? 'NV'}</td>
                    <td className="fit stars">{'★'.repeat(Math.floor(t.rating!))}{t.rating! % 1 ? '½' : ''}</td>
                    <td className="r fit">{dollars(t.market_now_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {recs.error ? <ErrorText error={recs.error} /> : null}
        </div>
      </div>
    </Page>
  );
}

const styleKey = (name: string): WineStyle => (Object.entries(STYLE_NAMES).find(([, v]) => v === name)?.[0] as WineStyle) ?? 'red';
