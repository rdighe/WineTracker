export const dollars = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(cents >= 10000 ? 0 : 2)}`;

/** Always with cents: prices shown as figures ("$319.05"). */
export const dollarsExact = (cents: number | null | undefined) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);

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
