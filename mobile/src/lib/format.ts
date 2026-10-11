export const dollars = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(cents >= 10000 ? 0 : 2)}`;

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
