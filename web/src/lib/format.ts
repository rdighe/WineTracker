/** Whole dollars, as the design system shows prices: "$48", "$1,220". */
export const dollars = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/** Compact dollars for chart axes: $80, $1.2K. */
export const dollarsShort = (cents: number) => {
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(d >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : `$${Math.round(d)}`;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** LWIN names a producer's main wine "Producer, Appellation"; drop the appellation where it's shown separately. */
export const wineTitle = (displayName: string, subRegion?: string | null) =>
  subRegion ? displayName.replace(new RegExp(`,\\s*${escapeRegExp(subRegion)}$`), '') : displayName;

/** "▲ +$55 +26%" / "▼ −$12 −9%": the design system's price change. */
export function change(from: number | null | undefined, to: number | null | undefined): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (!from || !to) return null;
  const diff = to - from;
  const pct = Math.round((diff / from) * 100);
  if (pct === 0) return { text: '±0%', dir: 'flat' };
  const sign = diff > 0 ? '+' : '−';
  return { text: `${diff > 0 ? '▲' : '▼'} ${sign}${dollars(Math.abs(diff))} ${sign}${Math.abs(pct)}%`, dir: diff > 0 ? 'up' : 'down' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03-07" -> "7 Mar 2026". */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y?.slice(2)}`;
};

/** How long ago, for "updated 3 days ago". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type WineStyle = 'red' | 'white' | 'rose' | 'sparkling' | 'orange' | 'fortified';

export const STYLE_NAMES: Record<WineStyle, string> = {
  red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', orange: 'Orange', fortified: 'Sweet & fortified',
};

/** The wine's style for its color dot and placeholder bottle (as in the app's theme.tsx). */
export function wineStyleOf(colour?: string | null, wineType?: string | null): WineStyle {
  const k = `${wineType ?? ''} ${colour ?? ''}`.toLowerCase();
  if (/sparkl|champagne/.test(k)) return 'sparkling';
  if (/fortif|port|sherry|madeira|dessert|sweet/.test(k)) return 'fortified';
  if (/ros/.test(k)) return 'rose';
  if (/orange|amber/.test(k)) return 'orange';
  if (/white/.test(k)) return 'white';
  return 'red';
}

/** A recommendation's style (sweet covers dessert and fortified) as a dot style. */
export const recStyleToWine = (s: string | undefined | null): WineStyle =>
  s === 'sweet' ? 'fortified' : s && s in STYLE_NAMES ? (s as WineStyle) : 'red';

export const place = (...parts: (string | null | undefined)[]) =>
  [...new Set(parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p) && p !== 'Other'))].join(' · ');

/** A random id for jobs (the API wants 16-64 letters, digits or dashes). */
export const newRef = () => crypto.randomUUID();
