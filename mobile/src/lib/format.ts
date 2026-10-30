/** Whole dollars, as the design system shows prices: "$48", "$1,220". */
export const dollars = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** LWIN names a producer's main wine "Producer, Appellation"; drop the appellation where it's shown separately. */
export const wineTitle = (displayName: string, subRegion?: string | null) =>
  subRegion ? displayName.replace(new RegExp(`,\\s*${escapeRegExp(subRegion)}$`), '') : displayName;

export const stars = (rating: number | null | undefined) => {
  if (rating == null) return 'Not rated';
  const full = Math.floor(rating);
  return '★'.repeat(full) + (rating - full >= 0.5 ? '½' : '');
};

/** "Paid $90 · now $42 (−53%)" style comparison. */
export function priceChange(paid: number | null, now: number | null): string | null {
  if (!paid || !now) return null;
  const pct = Math.round(((now - paid) / paid) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** Today as YYYY-MM-DD, in the phone's time zone. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03-07" -> "7 Mar 2026". */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** "tonight" from 5 pm until 4 am, else "today": how Home asks what you'd like to drink. */
export function partOfDay(d = new Date()): 'today' | 'tonight' {
  const h = d.getHours();
  return h >= 17 || h < 4 ? 'tonight' : 'today';
}
