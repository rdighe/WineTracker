/**
 * Wine lists, before you go: drop a restaurant's PDF list (or paste it), and
 * every wine on it comes back ranked for your palate with its markup over
 * typical retail, in a table you can sort and filter at a desk. Lists saved
 * from the iPhone app open here too.
 */
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, Chip, Empty, ErrorText, Icon, Loading, Segmented, Stars, Stat, WinePhoto } from '../components/ui';
import { api, waitForJob } from '../lib/api';
import { dollars, newRef, recStyleToWine, shortDate, STYLE_NAMES } from '../lib/format';
import { startGoogleSignIn, useSession } from '../lib/session';
import type { PickItem, PickResult } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const MAX_PAGES = 8; // the API's MAX_PICK_PHOTOS
const MAX_CHARS = 30000; // the API's MAX_LIST_CHARS

export function Lists() {
  const session = useSession();
  const { id } = useParams();
  if (!session) return <ListsSignedOut />;
  return id ? <OpenList id={Number(id)} /> : <NewList />;
}

function ListsSignedOut() {
  return (
    <Page title="Wine lists">
      <section className="card lists-intro">
        <div className="stack-lg" style={{ maxWidth: 620 }}>
          <h2 className="t-wine-display">Read the wine list before you get to the table.</h2>
          <p className="t-body muted">
            Drop in a restaurant's PDF wine list. Every wine on it comes back ranked for your taste, with what it costs in shops,
            so you can see the markup on each bottle and glass — and walk in knowing what to order.
          </p>
          <div className="row"><Button size="lg" onClick={() => startGoogleSignIn('/lists')}>Sign in with Google to start</Button></div>
          <p className="t-foot">At the table, the iPhone app does the same from a photo of the list.</p>
        </div>
      </section>
    </Page>
  );
}

function NewList() {
  const navigate = useNavigate();
  const saved = useAsync(() => api.savedPicks(), []);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (pages: string[], note?: string) => {
    setError(null);
    setStatus(`Reading the list${note ? ` (${note})` : ''}…`);
    try {
      const ref = newRef();
      await api.pickFromList(pages, ref);
      const result = await waitForJob<PickResult>(ref, (s) => setStatus(`Reading the list and matching each wine… ${s}s${note ? ` · ${note}` : ''}`));
      navigate(`/lists/${result.pickId}`);
    } catch (e) {
      setError(e);
      setStatus(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      if (file.type.startsWith('text/')) return setText((await file.text()).slice(0, MAX_CHARS));
      return setError(new Error('Choose a PDF. For a photo of a list, use the iPhone app: it reads photos with the camera.'));
    }
    setStatus('Opening the PDF…');
    try {
      // pdf.js is large: loaded only when a PDF is dropped.
      const { readPdfList } = await import('../lib/pdf');
      const r = await readPdfList(file, MAX_PAGES, MAX_CHARS);
      if (!r.pages.length) {
        setStatus(null);
        return setError(new Error(r.scanned ? 'This PDF is a scan with no text in it. Share it to the WineTracker iPhone app, which reads scans.' : 'No text found in this PDF.'));
      }
      await run(r.pages, `${r.pages.length} of ${r.pageCount} pages${r.skipped ? `, ${r.skipped} with fewest vintages left out` : ''}`);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error && /password/i.test(e.message) ? new Error('This PDF is password-protected.') : e);
    }
  };

  return (
    <Page title="Wine lists" sub="Ranked for your taste, with the markup on every bottle">
      <div className="split">
        <div className="stack-lg">
          <section className="card">
            <h2 className="t-section">Plan a dinner</h2>
            <div
              className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0}
              onClick={() => fileInput.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files[0]); }}
            >
              <span className="feature"><span className="icon-badge"><Icon name="document" size={20} /></span></span>
              <span className="t-section">Drop a restaurant's wine list here</span>
              <span className="t-foot">A PDF from the restaurant's website. It's read in your browser; only the text is sent.</span>
              <input ref={fileInput} type="file" accept="application/pdf,.pdf,text/plain" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            <details className="more">
              <summary>Or paste the list</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <textarea className="input" style={{ minHeight: 200, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                  placeholder={'Copied from the restaurant\'s site, one wine per line:\n2019 Ridge Monte Bello, Santa Cruz Mountains  480\nDomaine Tempier Bandol Rosé 2023  22 / 88'} />
                <div className="row"><Button disabled={text.trim().length < 20 || Boolean(status)} onClick={() => run([text])}>Rank this list</Button></div>
              </div>
            </details>
            {status ? <div className="stack" aria-live="polite"><div className="progress"><div /></div><span className="t-foot">{status}</span></div> : null}
            <ErrorText error={error} />
          </section>
          <section className="card">
            <h3 className="t-section">How it works</h3>
            <div className="grid grid-3">
              <div className="feature"><span className="t-label">1 · Read</span><span className="t-foot">Each wine's producer, name, vintage and its glass and bottle prices are read off the list.</span></div>
              <div className="feature"><span className="t-label">2 · Match</span><span className="t-foot">Each one is matched to the catalog and its current US shop price per 750 ml.</span></div>
              <div className="feature"><span className="t-label">3 · Rank</span><span className="t-foot">Ranked by how well it fits what you rate highly, with the markup over retail beside it.</span></div>
            </div>
          </section>
        </div>
        <aside className="pane">
          <div className="pane-body">
            <h3 className="t-section">Saved lists</h3>
            {saved.loading && !saved.data ? <Loading /> : saved.data?.saved.length ? (
              <div className="stack" style={{ gap: 2 }}>
                {saved.data.saved.map((s) => (
                  <Link key={s.pickId} to={`/lists/${s.pickId}`} className="search-item">
                    <span className="t-wine-cell">{s.name}</span>
                    <span className="t-foot">{s.kind === 'shelf' ? 'Shelf' : 'List'} · {s.wines} wines · {shortDate(s.savedAt)}{s.topPick ? ` · top pick ${s.topPick}` : ''}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="t-foot">Lists and shelves you save, here or in the iPhone app, show up here.</p>}
            <ErrorText error={saved.error} />
          </div>
        </aside>
      </div>
    </Page>
  );
}

type Sort = 'fit' | 'markup' | 'bottle' | 'listed';

function OpenList({ id }: { id: number }) {
  const navigate = useNavigate();
  const list = useAsync(() => api.openPick(id), [id]);
  const [sort, setSort] = useState<Sort>('fit');
  const [styles, setStyles] = useState<Set<string>>(new Set());
  const [maxBottle, setMaxBottle] = useState('');
  const [glassOnly, setGlassOnly] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<unknown>(null);

  const data = list.data;
  const items = data?.items ?? [];
  const fitRank = useMemo(() => new Map([...items].filter((i) => i.score != null).sort((a, b) => b.score! - a.score!).map((x, i) => [x.index, i + 1])), [items]);
  const presentStyles = useMemo(() => [...new Set(items.map((i) => i.style).filter(Boolean))], [items]);
  const shown = useMemo(() => {
    const cap = Number(maxBottle) * 100 || Infinity;
    const list = items.filter((i) => (!styles.size || styles.has(i.style)) && (i.entry.bottleCents ?? 0) <= cap && (!glassOnly || i.entry.glassCents != null));
    const by: Record<Sort, (a: PickItem, b: PickItem) => number> = {
      fit: (a, b) => (b.score ?? -99) - (a.score ?? -99) || (a.markup ?? 99) - (b.markup ?? 99),
      markup: (a, b) => (a.markup ?? a.glassMarkup ?? 99) - (b.markup ?? b.glassMarkup ?? 99),
      bottle: (a, b) => (a.entry.bottleCents ?? a.entry.glassCents ?? 1e9) - (b.entry.bottleCents ?? b.entry.glassCents ?? 1e9),
      listed: (a, b) => a.index - b.index,
    };
    return [...list].sort(by[sort]);
  }, [items, styles, maxBottle, glassOnly, sort]);

  const stats = useMemo(() => {
    const marked = items.filter((i) => i.markup != null);
    const avg = marked.length ? marked.reduce((n, i) => n + i.markup!, 0) / marked.length : null;
    const value = [...marked].sort((a, b) => a.markup! - b.markup!)[0];
    const best = [...items].filter((i) => i.score != null).sort((a, b) => b.score! - a.score!)[0];
    // Good for you and fairly priced: among the top quarter by fit, the lowest markup.
    const topQuarter = [...items].filter((i) => i.score != null).sort((a, b) => b.score! - a.score!).slice(0, Math.max(3, Math.ceil(items.length / 4)));
    const smart = topQuarter.filter((i) => i.markup != null).sort((a, b) => a.markup! - b.markup!)[0];
    return { avg, value, best, smart, matched: items.filter((i) => i.match !== 'guess').length };
  }, [items]);

  if (list.error && !data) return <Page title="Wine list"><ErrorText error={list.error} /><Link className="link" to="/lists">Back to wine lists</Link></Page>;
  if (!data) return <Page title="Wine list"><Loading label="Opening the list" /></Page>;

  const save = async () => {
    setBusy(true);
    try {
      await api.savePick(id, name.trim() || `Wine list ${shortDate(new Date().toISOString())}`);
      list.reload();
    } catch (e) {
      setMsg(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title={data.saved ? data.name : 'New wine list'}
      sub={`${items.length} wines · ${stats.matched} matched to a shop price`}
      action={data.saved ? (
        <Button variant="plain" onClick={async () => { if (confirm('Delete this saved list?')) { await api.deletePick(id); navigate('/lists'); } }}>Delete</Button>
      ) : null}
      wide
    >
      {!data.saved ? (
        <section className="card">
          <div className="row wrap">
            <input className="input" style={{ maxWidth: 320 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it, e.g. the restaurant" aria-label="List name" />
            <Button busy={busy} onClick={save}>Save list</Button>
            <span className="t-foot">Saved lists open in the iPhone app too, scored afresh as your taste changes.</span>
          </div>
          <ErrorText error={msg} />
        </section>
      ) : null}

      {data.mode === 'locked' ? (
        <p className="t-foot caution">Rate {Math.max(0, 3 - data.rated)} more wines to rank lists for your taste. Until then, wines are ordered by value.</p>
      ) : null}

      <section className="card">
        <div className="grid grid-4">
          <Stat label="Best fit for you" value={stats.best ? <span className="list-stat">{stats.best.displayName}</span> : '—'} hint={stats.best ? priceLine(stats.best) : undefined} />
          <Stat label="Smart order" value={stats.smart ? <span className="list-stat">{stats.smart.displayName}</span> : '—'} hint={stats.smart ? `a top match at ${stats.smart.markup}× retail` : 'needs matched prices'} />
          <Stat label="Lowest markup" value={stats.value ? <span className="list-stat">{stats.value.displayName}</span> : '—'} hint={stats.value ? `${stats.value.markup}× retail · ${priceLine(stats.value)}` : undefined} />
          <Stat label="Typical markup" value={stats.avg ? `${stats.avg.toFixed(1)}×` : '—'} hint="list price over shop price, per bottle" />
        </div>
      </section>

      <div className="row wrap" style={{ gap: 'var(--space-3)' }}>
        <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'fit', label: 'Best fit' }, { value: 'markup', label: 'Lowest markup' }, { value: 'bottle', label: 'Price' }, { value: 'listed', label: 'As listed' }]} />
        <input className="input" style={{ width: 150 }} inputMode="numeric" placeholder="Max bottle $" value={maxBottle} onChange={(e) => setMaxBottle(e.target.value.replace(/\D/g, ''))} aria-label="Most per bottle, dollars" />
        <Chip on={glassOnly} onClick={() => setGlassOnly((v) => !v)}>By the glass</Chip>
        <div className="chips">
          {presentStyles.map((s) => (
            <Chip key={s} dot={recStyleToWine(s)} on={styles.has(s)} onClick={() => setStyles((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; })}>
              {s === 'sweet' ? 'Sweet' : STYLE_NAMES[recStyleToWine(s)]}
            </Chip>
          ))}
        </div>
      </div>

      <section className="card flush">
        {shown.length ? (
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="dt">
              <thead>
                <tr><th className="fit">Fit</th><th>Wine</th><th className="fit">Vintage</th><th className="r fit">Glass</th><th className="r fit">Bottle</th><th className="r fit">In shops</th><th className="r fit">Markup</th><th>Why</th></tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const rank = fitRank.get(i.index);
                  const m = i.markup ?? i.glassMarkup;
                  return (
                    <tr key={i.index} onClick={() => i.wineId && navigate(`/wines/${i.wineId}`)} style={i.wineId ? undefined : { cursor: 'default' }}>
                      <td className="fit num">{rank && rank <= 3 && data.mode === 'profile' ? <span className="badge accent">#{rank}</span> : rank ?? '—'}</td>
                      <td style={{ width: '34%' }}>
                        <div className="wine-cell">
                          <WinePhoto uri={i.imageUrl} style={recStyleToWine(i.style)} className="photo-cell" />
                          <span className={`dot ${recStyleToWine(i.style)}`} />
                          <span className="name" title={`${i.displayName}\nOn the list: ${i.entry.text}`}>{i.displayName}</span>
                          {i.match === 'guess' ? <span className="badge" title="Not in the catalog: judged from what's printed">not matched</span> : null}
                          {i.myRating != null ? <Stars rating={i.myRating} /> : null}
                        </div>
                      </td>
                      <td className="fit">{i.entry.vintage || '—'}</td>
                      <td className="r fit">{dollars(i.entry.glassCents)}</td>
                      <td className="r fit" style={{ fontWeight: 600 }}>{dollars(i.entry.bottleCents)}</td>
                      <td className="r fit muted">{dollars(i.retailCents)}</td>
                      <td className={`r fit ${m == null ? 'faint' : m <= 2 ? 'up' : m >= 3.5 ? 'down' : ''}`} style={{ fontWeight: 600 }}>{m == null ? '—' : `${m.toFixed(1)}×${i.markup == null ? ' glass' : ''}`}</td>
                      <td className="muted" title={i.reasons.join(' · ')}>{i.reasons.join(' · ') || i.region || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="filter" title="No wines match these filters" />}
      </section>
      <p className="t-foot">Markup is the list's bottle price over the median US shop price for the same wine and vintage (a glass counts as a fifth of a bottle). <span className="up">2× or less</span> is fair for a restaurant; <span className="down">3.5× or more</span> is steep.</p>
    </Page>
  );
}

const priceLine = (i: PickItem) => [i.entry.bottleCents ? `${dollars(i.entry.bottleCents)} bottle` : '', i.entry.glassCents ? `${dollars(i.entry.glassCents)} glass` : ''].filter(Boolean).join(' · ');
