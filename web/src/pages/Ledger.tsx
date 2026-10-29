/**
 * The cellar and the tasting log as a ledger: a dense sortable table with a
 * detail pane beside it, what the cellar cost against what it's worth now,
 * filters, arrow-key browsing and a CSV export (for insurance or a
 * spreadsheet) — the things a phone screen is too small for.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, Chip, Empty, ErrorText, Icon, Loading, PriceRange, Segmented, Stars, Stat, StyleDot, WinePhoto } from '../components/ui';
import { api } from '../lib/api';
import { change, dollars, place, shortDate, STYLE_NAMES, wineStyleOf, wineTitle, type WineStyle } from '../lib/format';
import { reloadMine, useMine } from '../lib/store';
import type { PriceSummary, Tasting } from '../lib/types';
import { downloadCsv } from '../lib/csv';

type Mode = 'cellar' | 'tasted';
type SortKey = 'wine' | 'vintage' | 'bottles' | 'rating' | 'paid' | 'market' | 'change' | 'value' | 'date';

interface Row {
  t: Tasting;
  style: WineStyle;
  title: string;
  bottles: number;
  value: number | null;
  cost: number | null;
  pct: number | null;
}

export function Ledger({ mode }: { mode: Mode }) {
  const mine = useMine();
  const navigate = useNavigate();
  const [styles, setStyles] = useState<Set<WineStyle>>(new Set());
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });
  const [selected, setSelected] = useState<number | null>(null);

  const rows = useMemo<Row[]>(() => (mine.tastings ?? [])
    .filter((t) => t.kind === mode)
    .map((t) => {
      const bottles = mode === 'cellar' ? (t.bottles ?? 1) : 1;
      return {
        t, style: wineStyleOf(t.colour, t.wine_type), title: wineTitle(t.display_name, t.sub_region), bottles,
        value: t.market_now_cents != null ? t.market_now_cents * bottles : null,
        cost: t.paid_750_cents != null ? t.paid_750_cents * bottles : null,
        pct: t.paid_750_cents && t.market_now_cents ? (t.market_now_cents - t.paid_750_cents) / t.paid_750_cents : null,
      };
    }), [mine.tastings, mode]);

  const countries = useMemo(() => [...new Set(rows.map((r) => r.t.country).filter(Boolean))].sort(), [rows]);
  const presentStyles = useMemo(() => (Object.keys(STYLE_NAMES) as WineStyle[]).filter((s) => rows.some((r) => r.style === s)), [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!styles.size || styles.has(r.style)) && (!country || r.t.country === country) &&
      (!term || `${r.t.display_name} ${r.t.region} ${r.t.grape} ${r.t.notes} ${r.t.tags.join(' ')}`.toLowerCase().includes(term)));
    const val: Record<SortKey, (r: Row) => number | string | null> = {
      wine: (r) => r.title.toLowerCase(), vintage: (r) => r.t.vintage_key ?? '', bottles: (r) => r.bottles, rating: (r) => r.t.rating,
      paid: (r) => r.t.paid_750_cents, market: (r) => r.t.market_now_cents, change: (r) => r.pct, value: (r) => r.value, date: (r) => r.t.tasted_on,
    };
    const get = val[sort.key];
    return [...list].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // blanks last either way
      if (y == null) return -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [rows, styles, country, q, sort]);

  const totals = useMemo(() => {
    const priced = shown.filter((r) => r.value != null && r.cost != null);
    const cost = priced.reduce((n, r) => n + r.cost!, 0);
    const value = priced.reduce((n, r) => n + r.value!, 0);
    const rated = shown.filter((r) => r.t.rating != null);
    return {
      bottles: shown.reduce((n, r) => n + r.bottles, 0),
      cost, value, pricedBottles: priced.reduce((n, r) => n + r.bottles, 0),
      marketAll: shown.reduce((n, r) => n + (r.value ?? 0), 0),
      spent: shown.reduce((n, r) => n + (r.t.paid_750_cents ?? 0), 0),
      avgRating: rated.length ? rated.reduce((n, r) => n + r.t.rating!, 0) / rated.length : null,
    };
  }, [shown]);

  const sel = shown.find((r) => r.t.tasting_id === selected) ?? null;
  useEffect(() => {
    if (selected == null && shown[0] && window.innerWidth > 1100) setSelected(shown[0].t.tasting_id);
  }, [shown, selected]);

  // Arrow keys move through the table; the pane follows.
  const onKey = useCallback((e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key) || (e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
    e.preventDefault();
    const i = shown.findIndex((r) => r.t.tasting_id === selected);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      setSelected(next.t.tasting_id);
      document.getElementById(`row-${next.t.tasting_id}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [shown, selected]);
  useEffect(() => {
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onKey]);

  const exportCsv = () => downloadCsv(`${mode === 'cellar' ? 'cellar' : 'tastings'}-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Wine', 'Producer', 'Vintage', 'Style', 'Region', 'Country', 'Grape', ...(mode === 'cellar' ? ['Bottles'] : ['Rating']), 'Paid per 750 ml', 'Market per 750 ml', ...(mode === 'cellar' ? ['Market value'] : []), 'Date', 'Notes', 'Tags'],
    ...shown.map((r) => [
      r.t.display_name, r.t.producer, r.t.vintage_key ?? '', STYLE_NAMES[r.style], r.t.region, r.t.country, r.t.grape,
      ...(mode === 'cellar' ? [String(r.bottles)] : [r.t.rating == null ? '' : String(r.t.rating)]),
      cents(r.t.paid_750_cents), cents(r.t.market_now_cents), ...(mode === 'cellar' ? [cents(r.value)] : []), r.t.tasted_on?.slice(0, 10) ?? '', r.t.notes, r.t.tags.join('; '),
    ]),
  ]);

  const gain = change(totals.cost, totals.value);
  const th = (key: SortKey, label: string, right?: boolean) => (
    <th className={`${right ? 'r' : ''} ${sort.key === key ? 'sorted' : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'wine' && key !== 'vintage' }))}>
        {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  return (
    <Page
      title={mode === 'cellar' ? 'Cellar' : 'Tasted'}
      sub={mine.tastings ? (mode === 'cellar' ? `${rows.length} wines · ${rows.reduce((n, r) => n + r.bottles, 0)} bottles` : `${rows.length} tastings`) : undefined}
      action={<Button variant="secondary" icon="download" onClick={exportCsv} disabled={!shown.length}>Export CSV</Button>}
      wide
    >
      {mine.error && !mine.tastings ? <ErrorText error={mine.error} /> : null}
      {!mine.tastings ? <Loading /> : !rows.length ? (
        <div className="card">
          <Empty icon={mode === 'cellar' ? 'bottle' : 'glass'} title={mode === 'cellar' ? 'Your cellar is empty' : 'No tastings yet'}>
            <p>Find a wine with the search above and choose {mode === 'cellar' ? 'Add to cellar' : 'Log tasting'}, scan labels in the iPhone app, or <Link className="link" to="/settings">import from Vivino</Link>.</p>
          </Empty>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="grid grid-4">
              {mode === 'cellar' ? (
                <>
                  <Stat label="Bottles" value={totals.bottles.toLocaleString('en-US')} hint={`${shown.length} wines`} />
                  <Stat label="Worth now" value={dollars(totals.marketAll)} hint="market price × bottles" />
                  <Stat label="Cost" value={dollars(totals.cost)} hint={totals.pricedBottles < totals.bottles ? `${totals.pricedBottles} of ${totals.bottles} bottles have a price paid and a market price` : 'what you paid'} />
                  <Stat label="Change on those" value={gain ? `${totals.value >= totals.cost ? '+' : '−'}${Math.abs(Math.round((totals.value / totals.cost - 1) * 100))}%` : '—'} delta={gain?.text} deltaDir={gain?.dir} hint={gain ? undefined : 'add what you paid to see it'} />
                </>
              ) : (
                <>
                  <Stat label="Tastings" value={shown.length.toLocaleString('en-US')} />
                  <Stat label="Average rating" value={totals.avgRating ? totals.avgRating.toFixed(1) : '—'} hint="of 5" />
                  <Stat label="Spent" value={dollars(totals.spent)} hint="where you noted a price" />
                  <Stat label="Wines rated 4+" value={shown.filter((r) => (r.t.rating ?? 0) >= 4).length} hint={<Link className="link" to="/palate">See your palate report</Link>} />
                </>
              )}
            </div>
          </section>

          <div className="row wrap" style={{ gap: 'var(--space-3)' }}>
            <Segmented label="List" tinted value={mode} onChange={(m) => navigate(m === 'cellar' ? '/cellar' : '/tasted')} options={[{ value: 'cellar', label: 'Cellar' }, { value: 'tasted', label: 'Tasted' }]} />
            <input className="input" style={{ width: 240 }} placeholder="Filter by name, grape, note" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />
            {countries.length > 1 ? (
              <select className="input" style={{ width: 180 }} value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
                <option value="">All countries</option>
                {countries.map((c) => <option key={c}>{c}</option>)}
              </select>
            ) : null}
            <div className="chips">
              {presentStyles.map((s) => (
                <Chip key={s} dot={s} on={styles.has(s)} onClick={() => setStyles((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; })}>{STYLE_NAMES[s]}</Chip>
              ))}
            </div>
          </div>

          <div className="split">
            <section className="card flush">
              <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 300 }}>
                <table className="dt">
                  <thead>
                    <tr>
                      {th('wine', 'Wine')}
                      {th('vintage', 'Vintage')}
                      {mode === 'cellar' ? th('bottles', 'Bottles', true) : th('rating', 'Rating')}
                      {th('paid', 'Paid', true)}
                      {th('market', 'Market', true)}
                      {th('change', 'Change', true)}
                      {mode === 'cellar' ? th('value', 'Value', true) : null}
                      {th('date', mode === 'cellar' ? 'Added' : 'Tasted')}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const c = change(r.t.paid_750_cents, r.t.market_now_cents);
                      return (
                        <tr key={r.t.tasting_id} id={`row-${r.t.tasting_id}`} className={r.t.tasting_id === selected ? 'selected' : ''} onClick={() => setSelected(r.t.tasting_id)}
                          tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(r.t.tasting_id)} aria-selected={r.t.tasting_id === selected}>
                          <td style={{ width: '42%' }}>
                            <div className="wine-cell">
                              <WinePhoto uri={r.t.image_url} style={r.style} className="photo-cell" />
                              <span className={`dot ${r.style}`} title={STYLE_NAMES[r.style]} />
                              <span className="name" title={r.title}>{r.title}</span>
                            </div>
                          </td>
                          <td className="fit">{r.t.vintage_key ?? 'NV'}</td>
                          {mode === 'cellar' ? <td className="r fit">{r.bottles}</td> : <td className="fit"><Stars rating={r.t.rating} /></td>}
                          <td className="r fit">{dollars(r.t.paid_750_cents)}</td>
                          <td className="r fit">{dollars(r.t.market_now_cents)}</td>
                          <td className={`r fit ${c?.dir === 'up' ? 'up' : c?.dir === 'down' ? 'down' : 'faint'}`}>{c ? `${c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : ''} ${Math.round((r.pct ?? 0) * 100)}%` : '—'}</td>
                          {mode === 'cellar' ? <td className="r fit" style={{ fontWeight: 600 }}>{dollars(r.value)}</td> : null}
                          <td className="fit muted">{shortDate(r.t.tasted_on)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            {sel ? <DetailPane key={sel.t.tasting_id} row={sel} mode={mode} onGone={() => setSelected(null)} /> : <div className="pane"><div className="pane-body muted">Select a wine to see it here.</div></div>}
          </div>
          <p className="t-foot">Prices are per 750 ml, the median across US shops. Use ↑ and ↓ to move through the list.</p>
        </>
      )}
    </Page>
  );
}

const cents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

function DetailPane({ row, mode, onGone }: { row: Row; mode: Mode; onGone: () => void }) {
  const t = row.t;
  const [summary, setSummary] = useState<PriceSummary | null>(null);
  const [bottles, setBottles] = useState(row.bottles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.wine(t.wine_id).then((r) => setSummary(r.prices.find((p) => p.vintage_key === (t.market_vintage_key ?? t.vintage_key ?? '*')) ?? r.prices.find((p) => p.vintage_key === '*') ?? null), () => {});
  }, [t.wine_id, t.market_vintage_key, t.vintage_key]);

  const act = async (fn: () => Promise<unknown>, gone = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reloadMine();
      if (gone) onGone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const c = change(t.paid_750_cents, t.market_now_cents);

  return (
    <aside className="pane fade-up" aria-label="Selected wine">
      <WinePhoto uri={t.image_url} style={row.style} emptyLabel="No photo yet" />
      <div className="pane-body">
        <div className="stack" style={{ gap: 4 }}>
          <h2 className="t-wine-display" style={{ fontSize: 24, lineHeight: '30px' }}>{row.title}</h2>
          <div className="row wrap muted"><StyleDot style={row.style} label /><span>· {t.vintage_key ?? 'NV'}</span><span>· {place(t.sub_region, t.region, t.country)}</span></div>
        </div>
        <div className="three-up">
          <div><span className="t-label">Market</span><span className="v">{dollars(t.market_now_cents)}</span><span className="t-foot">{t.market_vintage_key && t.market_vintage_key !== '*' ? t.market_vintage_key : 'all vintages'}</span></div>
          <div><span className="t-label">You paid</span><span className="v">{dollars(t.paid_750_cents)}</span><span className={`t-foot ${c?.dir === 'up' ? 'up' : c?.dir === 'down' ? 'down' : ''}`}>{c?.text ?? (t.price_context === 'restaurant' ? 'at a restaurant' : '—')}</span></div>
          <div><span className="t-label">{mode === 'cellar' ? 'Bottles' : 'Your rating'}</span><span className="v">{mode === 'cellar' ? bottles : t.rating ?? '—'}</span><span className="t-foot">{mode === 'cellar' ? `worth ${dollars(t.market_now_cents != null ? t.market_now_cents * bottles : null)}` : <Stars rating={t.rating} />}</span></div>
        </div>
        {summary ? (
          <div className="card">
            <span className="t-label">Market price · {summary.n_merchants} {summary.n_merchants === 1 ? 'shop' : 'shops'}</span>
            <PriceRange median={summary.median_cents} p10={summary.p10_cents} p90={summary.p90_cents} paid={t.paid_750_cents} />
          </div>
        ) : null}
        {mode === 'cellar' ? (
          <div className="row">
            <span className="t-label" style={{ marginRight: 'auto' }}>Bottles in the cellar</span>
            <Button variant="secondary" size="sm" aria-label="One fewer bottle" disabled={busy || bottles <= 1} onClick={() => { setBottles(bottles - 1); void act(() => api.updateTasting(t.tasting_id, { bottles: bottles - 1 })); }}>−</Button>
            <span className="t-figure" style={{ minWidth: 28, textAlign: 'center' }}>{bottles}</span>
            <Button variant="secondary" size="sm" aria-label="One more bottle" disabled={busy} onClick={() => { setBottles(bottles + 1); void act(() => api.updateTasting(t.tasting_id, { bottles: bottles + 1 })); }}>+</Button>
          </div>
        ) : null}
        {t.notes || t.tags.length ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="t-label">{mode === 'cellar' ? 'Notes' : 'Your notes'}</span>
            {t.notes ? <p className="notes">{t.notes}</p> : null}
            {t.tags.length ? <div className="chips">{t.tags.map((g) => <span key={g} className="badge accent">{g}</span>)}</div> : null}
          </div>
        ) : null}
        <p className="t-foot">{mode === 'cellar' ? 'Added' : 'Tasted'} {shortDate(t.tasted_on)}{t.setting ? ` · ${t.setting}` : ''}</p>
        <ErrorText error={error} />
        <div className="row wrap">
          <Link className="btn btn-tinted" to={`/wines/${t.wine_id}`}><Icon name="chart" size={17} />Price dossier</Link>
          {mode === 'cellar' ? (
            <Button variant="secondary" busy={busy} onClick={() => act(() => api.removeFromCellar(t.tasting_id), true)}>Remove from cellar</Button>
          ) : (
            <Button variant="plain" busy={busy} onClick={() => confirm('Delete this tasting?') && act(() => api.deleteTasting(t.tasting_id), true)}>Delete</Button>
          )}
        </div>
      </div>
    </aside>
  );
}
