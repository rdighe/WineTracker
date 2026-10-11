/**
 * Mapping of LWIN dictionary rows (Liv-ex, Creative Commons) to catalog wines.
 *
 * LWIN columns: LWIN, STATUS, DISPLAY_NAME, PRODUCER_TITLE, PRODUCER_NAME,
 * WINE, COUNTRY, REGION, SUB_REGION, SITE, PARCEL, COLOUR, TYPE, SUB_TYPE,
 * DESIGNATION, CLASSIFICATION, ... Missing values are the string "NA".
 *
 * Identity: the wine's name is WINE + SITE + PARCEL. The appellation
 * (SUB_REGION) stays in sub_region, where the matcher uses it to explain
 * query words without requiring them - "Chateau d'Agassac" (name '') must
 * match a shop title that omits "Haut-Medoc", while "Ambroise Beaune 1er Cru
 * Les Perrieres" (name "Les Perrieres") stays distinct from his village Beaune.
 */
import type { NewWine } from './wines.js';

const WINE_TYPES = /^(wine|fortified wine)$/i;

/** Cell value -> trimmed string, with LWIN's "NA" as empty. */
export function cell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && 'text' in (v as object)) return cell((v as { text: unknown }).text);
  if (typeof v === 'object' && 'result' in (v as object)) return cell((v as { result: unknown }).result);
  const s = String(v).trim();
  return s === 'NA' || s === 'N/A' ? '' : s;
}

/** Map one LWIN row (lower-case header -> value) to a catalog wine, or null to skip. */
export function lwinRow(r: Record<string, unknown>): (NewWine & { lwin: string }) | null {
  const raw = cell(r.lwin);
  const num = Number(raw);
  const lwin = Number.isFinite(num) && num > 0 ? String(Math.round(num)) : raw.replace(/\D/g, '');
  if (lwin.length !== 7) return null;
  const status = cell(r.status);
  if (status && !/^live$/i.test(status)) return null;
  const type = cell(r.type);
  if (type && !WINE_TYPES.test(type)) return null;

  const producer = [cell(r.producer_title), cell(r.producer_name)].filter(Boolean).join(' ');
  const parts: string[] = [];
  for (const p of [cell(r.wine), cell(r.site), cell(r.parcel)]) if (p && !parts.includes(p)) parts.push(p);
  const name = parts.join(' ');
  if (!producer && !name) return null;

  const colour = cell(r.colour).toLowerCase();
  const sub = cell(r.sub_type).toLowerCase();
  return {
    lwin,
    producer,
    name,
    display_name: cell(r.display_name) || undefined,
    country: cell(r.country),
    region: cell(r.region),
    sub_region: cell(r.sub_region),
    colour: /ros/.test(colour) ? 'rose' : colour === 'red' || colour === 'white' ? colour : '',
    wine_type: /sparkling/.test(sub) ? 'sparkling' : /fortified/i.test(type) ? 'fortified' : /sweet|dessert/.test(sub) ? 'dessert' : 'still',
    classification: cell(r.classification),
    source: 'lwin',
  };
}
