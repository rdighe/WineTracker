/** Search the catalog from anywhere; Enter or a click opens the wine's price dossier. */
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { place } from '../lib/format';
import type { Candidate } from '../lib/types';
import { Icon } from './ui';

export function SearchBox({ placeholder = 'Search any wine for its price', autoFocus, onPick }: { placeholder?: string; autoFocus?: boolean; onPick?: (c: Candidate) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setResults([]);
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      api.search(term).then(
        (r) => { if (n === seq.current) { setResults(r.results); setActive(0); setBusy(false); } },
        () => { if (n === seq.current) setBusy(false); }
      );
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  const pick = (c: Candidate) => {
    setOpen(false);
    setQ('');
    if (onPick) onPick(c);
    else navigate(`/wines/${c.wineId}`);
  };

  return (
    <div className="search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <span className="icon"><Icon name="search" size={17} /></span>
      <input
        type="search" value={q} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder}
        role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) pick(results[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 ? (
        <div className="search-pop" id={listId} role="listbox">
          {results.length === 0 ? <div className="search-item muted">{busy ? 'Searching…' : 'No wines found. Try the producer and the wine name.'}</div> : null}
          {results.map((r, i) => (
            <div key={r.wineId} role="option" tabIndex={-1} aria-selected={i === active} className="search-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <span className="t-wine-cell">{r.displayName}</span>
              <span className="t-foot">{place(r.region, r.country) || 'Region unknown'}{r.shops ? ` · ${r.shops} ${r.shops === 1 ? 'shop' : 'shops'}` : ' · no prices yet'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
