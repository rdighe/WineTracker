/**
 * For you, at desk size: a search on top of your taste profile with every
 * filter visible at once, a grid of picks, and saved views you can reuse in
 * the iPhone app.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, Chip, Empty, ErrorText, Icon } from '../components/ui';
import { api } from '../lib/api';
import { dollars, recStyleToWine } from '../lib/format';
import type { RecSearch, RecStyle } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { RecGrid } from './Home';

const STYLES: { value: RecStyle; label: string }[] = [
  { value: 'red', label: 'Red' }, { value: 'white', label: 'White' }, { value: 'rose', label: 'Rosé' },
  { value: 'sparkling', label: 'Sparkling' }, { value: 'orange', label: 'Orange' }, { value: 'sweet', label: 'Sweet' },
];

export function Discover() {
  const [draft, setDraft] = useState<RecSearch & { bestValue?: boolean }>({});
  const [query, setQuery] = useState<RecSearch & { bestValue?: boolean }>({});
  const recs = useAsync(() => api.recommendations({ ...query, limit: 48 }), [JSON.stringify(query)]);
  const views = useAsync(() => api.recViews(), []);
  const [error, setError] = useState<unknown>(null);

  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleStyle = (s: RecStyle) => set({ styles: draft.styles?.includes(s) ? draft.styles.filter((x) => x !== s) : [...(draft.styles ?? []), s] });
  const apply = () => setQuery({ ...draft });
  const saveView = async () => {
    const name = prompt('Name this view', [draft.styles?.join(', '), draft.region, draft.food].filter(Boolean).join(' · ') || 'My view');
    if (!name) return;
    try {
      const { bestValue: _b, ...criteria } = draft;
      await api.saveRecView(name, criteria);
      views.reload();
    } catch (e) {
      setError(e);
    }
  };
  const summary = recs.data?.mode === 'profile' ? recs.data.summary : undefined;

  return (
    <Page title="For you" sub={summary ? `From ${summary.rated} rated wines${summary.flavors.length ? ` · you lean ${summary.flavors.slice(0, 3).join(', ')}` : ''}` : undefined}>
      <div className="discover">
        <aside className="card filters" aria-label="Find wines">
          <span className="t-section">Find wines</span>
          <div className="field"><span className="t-label">Style</span>
            <div className="chips">{STYLES.map((s) => <Chip key={s.value} dot={recStyleToWine(s.value)} on={Boolean(draft.styles?.includes(s.value))} onClick={() => toggleStyle(s.value)}>{s.label}</Chip>)}</div>
          </div>
          <div className="field"><span className="t-label">Price per bottle</span>
            <div className="row">
              <input className="input" inputMode="numeric" placeholder="$ min" value={draft.minPrice ?? ''} onChange={(e) => set({ minPrice: Number(e.target.value.replace(/\D/g, '')) || undefined })} aria-label="Lowest price" />
              <span className="faint">–</span>
              <input className="input" inputMode="numeric" placeholder="$ max" value={draft.maxPrice ?? ''} onChange={(e) => set({ maxPrice: Number(e.target.value.replace(/\D/g, '')) || undefined })} aria-label="Highest price" />
            </div>
          </div>
          <label className="field"><span className="t-label">Region</span><input className="input" placeholder="Burgundy, Willamette…" value={draft.region ?? ''} onChange={(e) => set({ region: e.target.value })} /></label>
          <label className="field"><span className="t-label">Tasting notes</span><input className="input" placeholder="Earthy, bright acidity…" value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
          <label className="field"><span className="t-label">With food</span><input className="input" placeholder="Roast chicken, oysters…" value={draft.food ?? ''} onChange={(e) => set({ food: e.target.value })} /></label>
          <Chip on={Boolean(draft.bestValue)} onClick={() => set({ bestValue: !draft.bestValue })}>Best value first</Chip>
          <div className="row wrap">
            <Button onClick={apply}>Find wines</Button>
            <Button variant="plain" onClick={() => { setDraft({}); setQuery({}); }}>Clear</Button>
          </div>
          <Button variant="secondary" size="sm" icon="bookmark" onClick={saveView}>Save as a view</Button>
          <ErrorText error={error} />
          {views.data?.views.length ? (
            <div className="field"><span className="t-label">Saved views</span>
              <div className="stack" style={{ gap: 2 }}>
                {views.data.views.map((v) => (
                  <div key={v.viewId} className="row between search-item" style={{ flexDirection: 'row' }} onClick={() => { setDraft(v.criteria); setQuery(v.criteria); }}>
                    <span>{v.name}</span>
                    <button className="btn btn-plain btn-sm" aria-label={`Delete ${v.name}`} onClick={async (e) => { e.stopPropagation(); await api.deleteRecView(v.viewId); views.reload(); }}><Icon name="close" size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
        <section className={recs.loading && recs.data ? 'loading-dim' : ''}>
          {recs.error ? <ErrorText error={recs.error} /> : null}
          {!recs.data ? <div className="wine-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 340 }} />)}</div>
            : recs.data.mode === 'locked' ? (
              <div className="card"><Empty icon="sparkle" title={`Rate ${recs.data.needed - recs.data.rated} more to unlock picks`}><p>Picks come from your ratings. <Link className="link" to="/settings">Import from Vivino</Link> to get there at once.</p></Empty></div>
            ) : recs.data.items.length ? (
              <>
                {summary?.priceLowCents ? <p className="t-foot" style={{ marginBottom: 12 }}>You usually spend {dollars(summary.priceLowCents)}–{dollars(summary.priceHighCents)}. Only wines in stock at a shop are shown.</p> : null}
                <RecGrid items={recs.data.items} />
              </>
            ) : <div className="card"><Empty icon="filter" title="Nothing matches all of that">Try a wider price range or fewer styles.</Empty></div>}
        </section>
      </div>
    </Page>
  );
}
