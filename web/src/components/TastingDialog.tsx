/** Log a tasting or add bottles to the cellar, from a wine's page (the app's two forms in one dialog). */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { todayIso } from '../lib/format';
import { reloadMine } from '../lib/store';
import { Button, ErrorText, Segmented } from './ui';

export function TastingDialog({ wineId, wineName, vintages, initialKind, open, onClose }: {
  wineId: number; wineName: string; vintages: string[]; initialKind: 'tasted' | 'cellar'; open: boolean; onClose: (saved: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState(initialKind);
  const [vintage, setVintage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [price, setPrice] = useState('');
  const [context, setContext] = useState<'retail' | 'restaurant'>('retail');
  const [bottles, setBottles] = useState('1');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setKind(initialKind);
      setError(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, initialKind]);

  const save = async () => {
    setError(null);
    if (vintage && !/^(1[89]\d\d|20\d\d|NV)$/.test(vintage)) return setError(new Error('Vintage should be a year or NV'));
    const paid = price.trim() ? Number(price.replace(/[$,]/g, '')) : null;
    if (paid != null && !(paid > 0)) return setError(new Error('Price should be a number of dollars, like 48'));
    setBusy(true);
    try {
      await api.addTasting({
        wineId, vintage: vintage || null, kind, notes: notes.trim() || undefined, tastedOn: date,
        rating: kind === 'tasted' ? rating : null, pricePaid: paid, priceContext: paid ? (kind === 'cellar' ? 'retail' : context) : null,
        bottles: kind === 'cellar' ? Math.max(1, Number(bottles) || 1) : null,
      });
      await reloadMine();
      setNotes('');
      setPrice('');
      setRating(null);
      onClose(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onClose={() => onClose(false)} aria-labelledby="td-title">
      <form method="dialog" className="stack-lg" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="row between">
          <h2 id="td-title" className="t-section">{wineName}</h2>
          <Segmented label="What to add" value={kind} onChange={setKind} options={[{ value: 'tasted', label: 'Log tasting' }, { value: 'cellar', label: 'Add to cellar' }]} />
        </div>
        <div className="grid grid-2">
          <label className="field">
            <span className="t-label">Vintage</span>
            <input className="input" list="td-vintages" value={vintage} onChange={(e) => setVintage(e.target.value.toUpperCase())} placeholder="2019 or NV" />
            <datalist id="td-vintages">{vintages.map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="field">
            <span className="t-label">{kind === 'cellar' ? 'Bought on' : 'Tasted on'}</span>
            <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="t-label">{kind === 'cellar' ? 'Paid per bottle' : 'Price paid'}</span>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$" />
          </label>
          {kind === 'cellar' ? (
            <label className="field">
              <span className="t-label">Bottles</span>
              <input className="input" type="number" min={1} max={999} value={bottles} onChange={(e) => setBottles(e.target.value)} />
            </label>
          ) : (
            <div className="field">
              <span className="t-label">Bought at</span>
              <Segmented label="Bought at" value={context} onChange={setContext} options={[{ value: 'retail', label: 'Shop' }, { value: 'restaurant', label: 'Restaurant' }]} />
            </div>
          )}
        </div>
        {kind === 'tasted' ? (
          <div className="field">
            <span className="t-label">Your rating</span>
            <div className="rating-input" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className="rating-star">
                  <button type="button" role="radio" aria-checked={rating === n - 0.5} aria-label={`${n - 0.5} stars`} className="half" onClick={() => setRating(n - 0.5)} />
                  <button type="button" role="radio" aria-checked={rating === n} aria-label={`${n} stars`} className="full" onClick={() => setRating(n)} />
                  <span aria-hidden="true" className={rating != null && rating >= n ? 'on' : rating != null && rating >= n - 0.5 ? 'half-on' : ''}>★</span>
                </span>
              ))}
              <span className="t-foot" style={{ marginLeft: 8 }}>{rating ? `${rating} / 5` : 'Tap a star'}</span>
            </div>
          </div>
        ) : null}
        <label className="field">
          <span className="t-label">{kind === 'cellar' ? 'Notes' : 'What stood out?'}</span>
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'cellar' ? 'Where you bought it, when to open it' : 'Dark cherry, cedar, a long savory finish'} />
        </label>
        <ErrorText error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => onClose(false)}>Cancel</Button>
          <Button type="submit" busy={busy}>{kind === 'cellar' ? 'Add to cellar' : 'Save tasting'}</Button>
        </div>
      </form>
    </dialog>
  );
}
