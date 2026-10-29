/** Import from Vivino, export everything, appearance and the account. */
import { useRef, useState } from 'react';
import { Page } from '../components/Layout';
import { Button, ErrorText, Icon, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { APP_NAME } from '../lib/config';
import { downloadCsv } from '../lib/csv';
import { signOutLocally, useSession } from '../lib/session';
import { reloadMine, useMine } from '../lib/store';
import { applyTheme, getTheme, type ThemePref } from '../lib/theme';
import type { ImportSummary } from '../lib/types';

export function Settings() {
  const session = useSession();
  const mine = useMine();
  const [theme, setTheme] = useState<ThemePref>(getTheme());
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > 8 * 1024 * 1024) return setError(new Error('That file is over 8 MB. Export just your wine list from Vivino.'));
    setBusy(true);
    try {
      setResult(await api.importVivino(await file.text()));
      await reloadMine();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const exportAll = () => {
    const t = mine.tastings ?? [];
    downloadCsv(`wine-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Kind', 'Wine', 'Producer', 'Vintage', 'Region', 'Country', 'Grape', 'Color', 'Rating', 'Bottles', 'Paid', 'Paid per 750 ml', 'Paid at', 'Market per 750 ml', 'Date', 'Notes', 'Tags'],
      ...t.map((x) => [
        x.kind, x.display_name, x.producer, x.vintage_key ?? '', x.region, x.country, x.grape, x.colour, x.rating == null ? '' : String(x.rating),
        x.bottles == null ? '' : String(x.bottles), c(x.price_paid_cents), c(x.paid_750_cents), x.price_context ?? '', c(x.market_now_cents), x.tasted_on?.slice(0, 10) ?? '', x.notes, x.tags.join('; '),
      ]),
    ]);
  };

  return (
    <Page title="Import & settings">
      <div className="grid grid-2">
        <section className="card">
          <h2 className="t-section">Import from Vivino</h2>
          <p className="t-foot">In Vivino, request your data (Settings › Privacy › Download my data), then drop the <code>full_wine_list.csv</code> here. Ratings, notes and prices come across; importing again adds nothing twice.</p>
          <div className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0}
            onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void importFile(e.dataTransfer.files[0]); }}>
            <Icon name="upload" size={22} />
            <span className="t-section">{busy ? 'Importing…' : 'Drop the CSV here, or choose it'}</span>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {busy ? <div className="progress"><div /></div> : null}
          <ErrorText error={error} />
          {result ? (
            <div className="stack" aria-live="polite">
              <p><strong>{result.imported}</strong> imported of {result.rows} rows{result.alreadyImported ? `, ${result.alreadyImported} were already here` : ''}{result.skipped ? `, ${result.skipped} skipped` : ''}.</p>
              <p className="t-foot">{result.matched} matched to the catalog; {result.addedWines} added as new wines.</p>
              {result.missingColumns.length ? <p className="t-foot caution">This file has no {result.missingColumns.join(', ')} column. Is it Vivino's full wine list?</p> : null}
            </div>
          ) : null}
        </section>
        <div className="stack-lg">
          <section className="card">
            <h2 className="t-section">Export</h2>
            <p className="t-foot">Everything you've logged — cellar and tastings, with what you paid and what it's worth now — as one CSV for a spreadsheet.</p>
            <div className="row"><Button variant="secondary" icon="download" onClick={exportAll} disabled={!mine.tastings?.length}>Download CSV</Button></div>
          </section>
          <section className="card">
            <h2 className="t-section">Appearance</h2>
            <Segmented label="Theme" value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </section>
          <section className="card">
            <h2 className="t-section">Account</h2>
            <p className="t-foot">Signed in as <strong>{session?.email}</strong>. The same Google account signs you in to the {APP_NAME} iPhone app.</p>
            <div className="row"><Button variant="secondary" onClick={() => { signOutLocally(); location.assign('/'); }}>Sign out</Button></div>
          </section>
        </div>
      </div>
    </Page>
  );
}

const c = (v: number | null) => (v == null ? '' : (v / 100).toFixed(2));
