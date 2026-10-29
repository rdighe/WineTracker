/**
 * A wine's price dossier, public: the market price with its range and
 * evidence, every vintage side by side, the price over time, every shop's
 * current offer, and the researched background. Signed in, it adds your own
 * bottles and tastings of it, and save / add / log.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LineChart, RangeColumns } from '../components/charts';
import { Page } from '../components/Layout';
import { TastingDialog } from '../components/TastingDialog';
import { Button, Chip, ErrorText, Icon, Loading, PriceRange, Stars, StyleDot, WinePhoto } from '../components/ui';
import { api } from '../lib/api';
import { ago, change, dollars, dollarsShort, place, shortDate, wineStyleOf, wineTitle } from '../lib/format';
import { rememberViewed } from '../lib/recent';
import { startGoogleSignIn, useSession } from '../lib/session';
import { reloadMine, useMine } from '../lib/store';
import type { InfoResponse, Offer, PriceSummary, PricesResponse } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const vintageOrder = (a: string, b: string) => (a === 'NV' ? 1 : b === 'NV' ? -1 : Number(a) - Number(b));

export function WinePage() {
  const id = Number(useParams().id);
  const session = useSession();
  const mine = useMine();
  const [vintage, setVintage] = useState('*');
  const [dialog, setDialog] = useState<'tasted' | 'cellar' | null>(null);
  const wine = useAsync(() => api.wine(id), [id]);
  const prices = useAsync<PricesResponse>(() => api.prices(id, vintage), [id, vintage]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  useEffect(() => setVintage('*'), [id]);
  useEffect(() => {
    if (wine.data) rememberViewed({ id, name: wine.data.wine.display_name, image: wine.data.wine.image_url ?? null, colour: wine.data.wine.colour });
  }, [id, wine.data]);

  const summaries = wine.data?.prices ?? [];
  const all = summaries.find((p) => p.vintage_key === '*') ?? null;
  const current = summaries.find((p) => p.vintage_key === vintage) ?? null;
  const vintages = summaries.filter((p) => p.vintage_key !== '*').sort((a, b) => vintageOrder(a.vintage_key, b.vintage_key));
  const myEntries = (mine.tastings ?? []).filter((t) => t.wine_id === id);
  const saved = (mine.saved ?? []).some((s) => s.wine_id === id);
  const paidRef = myEntries.find((t) => t.paid_750_cents && (vintage === '*' || t.vintage_key === vintage))?.paid_750_cents ?? null;

  if (wine.error && !wine.data) return <Page title="Wine"><ErrorText error={wine.error} /></Page>;
  if (!wine.data) return <Page title="Wine"><Loading /></Page>;
  const w = wine.data.wine;
  const style = wineStyleOf(w.colour, w.wine_type);
  const title = wineTitle(w.display_name, w.sub_region);

  const toggleSave = async () => {
    if (!session) return startGoogleSignIn();
    await (saved ? api.unsaveWine(id) : api.saveWine(id));
    await reloadMine();
  };
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await api.refreshPrices(id, vintage);
      wine.reload();
      prices.reload();
    } catch (e) {
      setRefreshError(e);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page title="Price dossier" sub={title}>
      <section className="wine-head">
        <WinePhoto uri={w.image_url} style={style} className="wine-head-photo" emptyLabel="No photo yet" />
        <div className="stack-lg" style={{ minWidth: 0 }}>
          <div className="stack" style={{ gap: 6 }}>
            <h2 className="t-wine-display">{title}</h2>
            <div className="row wrap muted">
              <StyleDot style={style} label />
              {place(w.sub_region, w.region, w.country) ? <span>· {place(w.sub_region, w.region, w.country)}</span> : null}
              {w.grape ? <span>· {w.grape}</span> : null}
              {w.lwin ? <span className="faint">· LWIN {w.lwin}</span> : null}
            </div>
          </div>
          <div className="three-up">
            <div>
              <span className="t-label">Market{vintage !== '*' ? `, ${vintage}` : ''}</span>
              <span className="v">{dollars(current?.median_cents)}</span>
              <span className="t-foot">per 750 ml</span>
            </div>
            <div>
              <span className="t-label">Evidence</span>
              <span className="v">{current?.n_merchants ?? 0} {current?.n_merchants === 1 ? 'shop' : 'shops'}</span>
              <span className={`t-foot ${current && isStale(current) ? 'caution' : ''}`}>{current ? `seen ${ago(current.latest_observed_at)}` : 'no prices yet'}</span>
            </div>
            <div>
              <span className="t-label">{myEntries.length ? 'You paid' : 'Vintages priced'}</span>
              <span className="v">{myEntries.length ? dollars(paidRef) : vintages.length}</span>
              <span className="t-foot">
                {myEntries.length ? (change(paidRef, current?.median_cents)?.text ?? 'per 750 ml') : 'with a current price'}
              </span>
            </div>
          </div>
          {current ? <PriceRange median={current.median_cents} p10={current.p10_cents} p90={current.p90_cents} paid={paidRef} /> : null}
          {current?.out_of_stock_only ? <p className="t-foot caution">No shop has this in stock right now: the price is from sold-out listings.</p> : null}
          <div className="row wrap">
            <Button icon="glass" onClick={() => (session ? setDialog('tasted') : startGoogleSignIn())}>Log tasting</Button>
            <Button variant="tinted" icon="bottle" onClick={() => (session ? setDialog('cellar') : startGoogleSignIn())}>Add to cellar</Button>
            <Button variant="secondary" icon="bookmark" onClick={toggleSave} aria-pressed={saved}>{saved ? 'Saved' : 'Save'}</Button>
            {session ? <Button variant="plain" icon="refresh" busy={refreshing} onClick={refresh}>Check prices now</Button> : null}
          </div>
          <ErrorText error={refreshError} />
        </div>
      </section>

      {vintages.length ? (
        vintages.length <= 12 ? (
          <div className="chips" role="group" aria-label="Vintage">
            <Chip on={vintage === '*'} onClick={() => setVintage('*')}>All vintages {all ? <span className="num">{dollars(all.median_cents)}</span> : null}</Chip>
            {vintages.map((v) => (
              <Chip key={v.vintage_key} on={vintage === v.vintage_key} onClick={() => setVintage(v.vintage_key)}>
                {v.vintage_key} <span className="num">{dollars(v.median_cents)}</span>
              </Chip>
            ))}
          </div>
        ) : (
          <label className="row">
            <span className="t-label">Vintage</span>
            <select className="input" style={{ width: 240 }} value={vintage} onChange={(e) => setVintage(e.target.value)}>
              <option value="*">All vintages{all ? ` · ${dollars(all.median_cents)}` : ''}</option>
              {[...vintages].reverse().map((v) => <option key={v.vintage_key} value={v.vintage_key}>{v.vintage_key} · {dollars(v.median_cents)}</option>)}
            </select>
            <span className="t-foot">or pick one on the chart</span>
          </label>
        )
      ) : null}

      <div className="grid grid-2">
        <VintageLadder vintages={vintages} selected={vintage} all={all} onSelect={setVintage} />
        <section className="card">
          <div className="card-head">
            <h3 className="t-section">Price over time{vintage !== '*' ? `, ${vintage}` : ''}</h3>
            <span className="t-foot">median of shops each day, per 750 ml</span>
          </div>
          {prices.data?.history.length ? (
            <div className={prices.loading ? 'loading-dim' : ''}>
              <LineChart
                label={`Market price of ${title} over time`}
                points={prices.data.history.map((h) => ({ t: new Date(h.day).getTime(), v: h.median_cents }))}
                format={dollarsShort}
                reference={paidRef ? { v: paidRef, label: `You paid ${dollars(paidRef)}` } : undefined}
              />
              <HistoryNote history={prices.data.history} />
            </div>
          ) : prices.loading ? <div className="skeleton" style={{ height: 220 }} /> : <p className="muted">No price history for this {vintage === '*' ? 'wine' : 'vintage'} yet.</p>}
        </section>
      </div>

      {myEntries.length ? (
        <section className="card flush">
          <div className="card-head" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <h3 className="t-section">Your bottles and tastings</h3>
            <Link className="link t-foot" to={myEntries.some((t) => t.kind === 'cellar') ? '/cellar' : '/tasted'}>Open in your ledger</Link>
          </div>
          <div className="table-wrap">
            <table className="dt">
              <thead><tr><th>Date</th><th>Kind</th><th>Vintage</th><th>Rating</th><th className="r">Paid</th><th className="r">Now</th><th>Notes</th></tr></thead>
              <tbody>
                {myEntries.map((t) => (
                  <tr key={t.tasting_id} style={{ cursor: 'default' }}>
                    <td className="fit">{shortDate(t.tasted_on)}</td>
                    <td className="fit">{t.kind === 'cellar' ? `Cellar · ${t.bottles ?? 1}` : 'Tasted'}</td>
                    <td className="fit">{t.vintage_key ?? '—'}</td>
                    <td className="fit"><Stars rating={t.rating} /></td>
                    <td className="r fit">{dollars(t.paid_750_cents)}</td>
                    <td className="r fit">{dollars(t.market_now_cents)}</td>
                    <td className="muted" title={t.notes}>{t.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Offers offers={prices.data?.offers ?? []} loading={prices.loading} vintage={vintage} />
      <About id={id} signedIn={Boolean(session)} />

      <TastingDialog
        wineId={id} wineName={title} vintages={vintages.map((v) => v.vintage_key)} initialKind={dialog ?? 'tasted'} open={dialog !== null}
        onClose={() => setDialog(null)}
      />
    </Page>
  );
}

const isStale = (p: PriceSummary) => Date.now() - new Date(p.latest_observed_at).getTime() > 30 * 86_400_000;

const LADDER = 16;

function VintageLadder({ vintages, selected, all, onSelect }: { vintages: PriceSummary[]; selected: string; all: PriceSummary | null; onSelect: (v: string) => void }) {
  const [every, setEvery] = useState(false);
  const allYears = vintages.filter((v) => v.vintage_key !== 'NV');
  // The latest vintages by default: one 1971 at $1,900 shouldn't flatten the rest.
  const years = every ? allYears : allYears.slice(-LADDER);
  const insight = useMemo(() => {
    if (years.length < 2 || !all) return null;
    const cheapest = [...years].sort((a, b) => a.median_cents - b.median_cents)[0]!;
    const dearest = [...years].sort((a, b) => b.median_cents - a.median_cents)[0]!;
    return { cheapest, dearest };
  }, [years, all]);
  return (
    <section className="card">
      <div className="card-head">
        <h3 className="t-section">Every vintage, side by side</h3>
        <span className="t-foot">median and the middle 80% of shop prices</span>
      </div>
      {allYears.length > LADDER ? (
        <div className="row"><Chip on={!every} onClick={() => setEvery(false)}>Latest {LADDER}</Chip><Chip on={every} onClick={() => setEvery(true)}>All {allYears.length}</Chip></div>
      ) : null}
      {years.length ? (
        <>
          <RangeColumns
            label="Price by vintage"
            items={years.map((v) => ({ key: v.vintage_key, median: v.median_cents, lo: v.p10_cents, hi: v.p90_cents, note: `${v.n_merchants} ${v.n_merchants === 1 ? 'shop' : 'shops'}` }))}
            format={dollarsShort}
            highlight={selected}
            onSelect={(k) => onSelect(k === selected ? '*' : k)}
          />
          {insight && insight.cheapest !== insight.dearest ? (
            <p className="t-foot">
              Least expensive now: <strong className="num" style={{ color: 'var(--ink)' }}>{insight.cheapest.vintage_key} at {dollars(insight.cheapest.median_cents)}</strong>.
              {' '}Most: {insight.dearest.vintage_key} at {dollars(insight.dearest.median_cents)}, {Math.round((insight.dearest.median_cents / insight.cheapest.median_cents - 1) * 100)}% more.
            </p>
          ) : null}
        </>
      ) : <p className="muted">No vintage has its own price yet.</p>}
    </section>
  );
}

function HistoryNote({ history }: { history: { day: string; median_cents: number }[] }) {
  if (history.length < 2) return null;
  const first = history[0]!;
  const last = history[history.length - 1]!;
  const c = change(first.median_cents, last.median_cents);
  return (
    <p className="t-foot" style={{ marginTop: 8 }}>
      Since {shortDate(first.day)}: <span className={c?.dir === 'up' ? 'up' : c?.dir === 'down' ? 'down' : ''} style={{ fontWeight: 600 }}>{c?.text ?? 'no change'}</span>
    </p>
  );
}

type OfferSort = 'per750' | 'shop' | 'vintage' | 'seen';

function Offers({ offers, loading, vintage }: { offers: Offer[]; loading: boolean; vintage: string }) {
  const [inStock, setInStock] = useState(true);
  const [sort, setSort] = useState<OfferSort>('per750');
  const shown = useMemo(() => {
    const list = offers.filter((o) => !inStock || o.in_stock !== false);
    const by: Record<OfferSort, (a: Offer, b: Offer) => number> = {
      per750: (a, b) => a.unit_750_cents - b.unit_750_cents,
      shop: (a, b) => (a.merchant ?? '').localeCompare(b.merchant ?? ''),
      vintage: (a, b) => (b.vintage_key ?? '').localeCompare(a.vintage_key ?? ''),
      seen: (a, b) => b.observed_at.localeCompare(a.observed_at),
    };
    return [...list].sort(by[sort]);
  }, [offers, inStock, sort]);
  const soldOut = offers.filter((o) => o.in_stock === false).length;
  const head = (key: OfferSort, label: string, right?: boolean) => (
    <th className={`${right ? 'r' : ''} ${sort === key ? 'sorted' : ''}`} aria-sort={sort === key ? 'ascending' : undefined}>
      <button onClick={() => setSort(key)}>{label}{sort === key ? ' ↓' : ''}</button>
    </th>
  );
  return (
    <section className="card flush">
      <div className="card-head" style={{ padding: 'var(--space-4) var(--space-5)' }}>
        <div>
          <h3 className="t-section">Where to buy{vintage !== '*' ? ` the ${vintage}` : ''}</h3>
          <span className="t-foot">Every US shop offer seen in the last 90 days, cheapest per 750 ml first.</span>
        </div>
        {soldOut ? <Chip on={!inStock} onClick={() => setInStock((v) => !v)}>Show {soldOut} sold out</Chip> : null}
      </div>
      {shown.length ? (
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className={`dt ${loading ? 'loading-dim' : ''}`}>
            <thead>
              <tr>{head('shop', 'Shop')}{head('vintage', 'Vintage')}<th className="r hide-narrow">Size</th><th className="r hide-narrow">Price</th>{head('per750', 'Per 750 ml', true)}<th className="hide-narrow">Stock</th>{head('seen', 'Seen')}<th className="fit"><span className="sr-only">Link</span></th></tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const stale = Date.now() - new Date(o.observed_at).getTime() > 30 * 86_400_000;
                return (
                  <tr key={o.url + o.observed_at} onClick={() => window.open(o.url, '_blank', 'noopener')}>
                    <td className="t-wine-cell">{o.merchant || hostOf(o.url)}</td>
                    <td className="fit">{o.vintage_key ?? '—'}</td>
                    <td className="r fit hide-narrow">{o.bottle_ml === 750 ? '750 ml' : o.bottle_ml >= 1000 ? `${o.bottle_ml / 1000} L` : `${o.bottle_ml} ml`}</td>
                    <td className="r fit hide-narrow">{dollars(o.price_cents)}</td>
                    <td className="r fit" style={{ fontWeight: 600 }}>{dollars(o.unit_750_cents)}</td>
                    <td className="fit hide-narrow">{o.in_stock === false ? <span className="badge">Sold out</span> : o.in_stock ? <span className="badge good">In stock</span> : <span className="faint">—</span>}</td>
                    <td className={`fit ${stale ? 'caution' : 'muted'}`}>{ago(o.observed_at)}</td>
                    <td className="fit"><a className="link" href={o.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${o.merchant ?? 'shop'}`}><Icon name="external" size={15} /></a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-5)' }} className="muted">{loading ? 'Loading offers…' : 'No shop offers in the last 90 days.'}</div>
      )}
    </section>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Shop';
  }
};

/** Researched background. Opening it signed in starts the research; it's polled while pending. */
function About({ id, signedIn }: { id: number; signedIn: boolean }) {
  const [info, setInfo] = useState<InfoResponse | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.wineInfo(id).then((r) => {
        if (stop) return;
        setInfo(r);
        if (r.status === 'pending') timer = setTimeout(load, 5000);
      }, () => {});
    setInfo(null);
    void load();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, signedIn]);
  const i = info?.info;
  if (!info) return null;
  if (!i) {
    if (info.status === 'pending') return <section className="card"><h3 className="t-section">About this wine</h3><div className="progress"><div /></div><p className="t-foot">Looking up tasting notes, the producer and the spec sheet…</p></section>;
    if (info.status === 'none' && !signedIn) return <section className="card"><h3 className="t-section">About this wine</h3><p className="muted">Sign in to look up its tasting notes, producer and spec sheet.</p></section>;
    return null;
  }
  const notes = Object.entries(i.tastingNotes).filter(([, v]) => v);
  const specs = Object.entries(i.specs).filter(([, v]) => v);
  return (
    <section className="grid grid-2">
      <div className="card">
        <h3 className="t-section">About this wine</h3>
        {i.summary ? <p className="t-body">{i.summary}</p> : null}
        {notes.length ? <dl className="kv">{notes.map(([k, v]) => <Fragment key={k}><dt>{cap(k)}</dt><dd>{v}</dd></Fragment>)}</dl> : null}
        {i.descriptors.length ? <div className="chips">{i.descriptors.map((d) => <span key={d} className="badge">{d}</span>)}</div> : null}
        {i.consensus ? <p className="t-foot">{i.consensus}</p> : null}
      </div>
      <div className="card">
        <h3 className="t-section">Serving and the producer</h3>
        <dl className="kv">
          {i.serving.drinkingWindow ? <><dt>Drink</dt><dd>{i.serving.drinkingWindow}</dd></> : null}
          {i.serving.temperature ? <><dt>Serve at</dt><dd>{i.serving.temperature}</dd></> : null}
          {i.serving.decant ? <><dt>Decant</dt><dd>{i.serving.decant}</dd></> : null}
          {i.foodPairings.length ? <><dt>With</dt><dd>{i.foodPairings.join(', ')}</dd></> : null}
          {specs.map(([k, v]) => <Fragment key={k}><dt>{specLabel[k] ?? cap(k)}</dt><dd>{v}</dd></Fragment>)}
        </dl>
        {i.producer.history ? <p className="t-foot">{i.producer.history}</p> : null}
        {i.sources.length ? (
          <details className="more">
            <summary>{i.sources.length} sources</summary>
            <ul className="t-foot">{i.sources.map((s) => <li key={s.url}><a className="link" href={s.url} target="_blank" rel="noopener noreferrer">{s.title || hostOf(s.url)}</a></li>)}</ul>
          </details>
        ) : null}
        {!i.grounded ? <p className="t-foot caution">From general knowledge, not checked against the web.</p> : null}
      </div>
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const specLabel: Record<string, string> = { abv: 'Alcohol', grapes: 'Grapes', aging: 'Aging', vinification: 'Winemaking', soil: 'Soil', production: 'Production' };

