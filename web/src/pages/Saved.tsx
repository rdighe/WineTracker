/** Saved wines as a watch list: today's market price for each, sortable, with the dossier one click away. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, Empty, ErrorText, Loading, WinePhoto } from '../components/ui';
import { api } from '../lib/api';
import { dollars, place, shortDate, STYLE_NAMES, wineStyleOf } from '../lib/format';
import { reloadMine, useMine } from '../lib/store';

export function Saved() {
  const mine = useMine();
  const navigate = useNavigate();
  const [sort, setSort] = useState<'date' | 'price'>('date');
  const rows = useMemo(() => [...(mine.saved ?? [])].sort((a, b) => (sort === 'price' ? (a.median_cents ?? 1e12) - (b.median_cents ?? 1e12) : b.created_at.localeCompare(a.created_at))), [mine.saved, sort]);
  if (mine.error && !mine.saved) return <Page title="Saved"><ErrorText error={mine.error} /></Page>;
  if (!mine.saved) return <Page title="Saved"><Loading /></Page>;
  return (
    <Page title="Saved" sub={`${rows.length} wines to try`}>
      {!rows.length ? <div className="card"><Empty icon="bookmark" title="Nothing saved yet">Save a wine from its page, here or in the iPhone app, to keep an eye on its price.</Empty></div> : (
        <section className="card flush">
          <table className="dt">
            <thead><tr><th>Wine</th><th>Region</th><th className="r"><button onClick={() => setSort('price')}>Market{sort === 'price' ? ' ↑' : ''}</button></th><th className="r">Shops</th><th><button onClick={() => setSort('date')}>Saved{sort === 'date' ? ' ↓' : ''}</button></th><th className="fit" /></tr></thead>
            <tbody>
              {rows.map((s) => {
                const style = wineStyleOf(s.colour, s.wine_type);
                return (
                  <tr key={s.wine_id} onClick={() => navigate(`/wines/${s.wine_id}`)}>
                    <td style={{ width: '40%' }}><div className="wine-cell"><WinePhoto uri={s.image_url} style={style} className="photo-cell" /><span className={`dot ${style}`} title={STYLE_NAMES[style]} /><span className="name" title={s.display_name}>{s.display_name}</span></div></td>
                    <td className="muted">{place(s.sub_region || s.region, s.country)}</td>
                    <td className="r fit" style={{ fontWeight: 600 }}>{dollars(s.median_cents)}</td>
                    <td className="r fit muted">{s.n_merchants ?? 0}</td>
                    <td className="fit muted">{shortDate(s.created_at)}</td>
                    <td className="fit"><Button variant="plain" size="sm" onClick={async (e) => { e.stopPropagation(); await api.unsaveWine(s.wine_id); await reloadMine(); }}>Remove</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </Page>
  );
}
