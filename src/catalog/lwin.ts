/** Mapping of LWIN dictionary rows (Liv-ex, Creative Commons) to catalog wines. */
import type { NewWine } from './wines.js';

const WINE_TYPES = /wine|champagne|port|sherry|madeira|fortified|sparkling|^$/i;

/** Map one LWIN row (header -> value) to a catalog wine, or null to skip. */
export function lwinRow(r: Record<string, string>): (NewWine & { lwin: string }) | null {
  const lwin = (r.lwin ?? '').replace(/\D/g, '');
  if (lwin.length < 7) return null;
  if (r.status && !/^live$/i.test(r.status)) return null;
  if (!WINE_TYPES.test(r.type ?? '')) return null;
  const producer = [r.producer_title, r.producer_name].filter((s) => s && s.trim()).join(' ').trim();
  const name = (r.wine ?? '').trim();
  if (!producer && !name) return null;
  const colour = (r.colour ?? '').toLowerCase();
  const sub = (r.sub_type ?? '').toLowerCase();
  return {
    lwin: lwin.slice(0, 7),
    producer,
    name,
    display_name: (r.display_name ?? '').trim() || undefined,
    country: r.country ?? '',
    region: r.region ?? '',
    sub_region: r.sub_region ?? '',
    colour: /ros/.test(colour) ? 'rose' : colour === 'red' || colour === 'white' ? colour : '',
    wine_type: /sparkling/.test(sub) ? 'sparkling' : /fortified|port|sherry|madeira/i.test(`${r.type} ${sub}`) ? 'fortified' : /sweet|dessert/.test(sub) ? 'dessert' : 'still',
    classification: r.classification ?? '',
    source: 'lwin',
  };
}
