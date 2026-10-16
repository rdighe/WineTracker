/**
 * Import ratings from a Vivino data export (CSV).
 *
 * Vivino doesn't document its export, so columns are found by name, in any
 * order, under the names such exports use ("Winery", "Wine name", "Vintage",
 * "Your rating", "Your review", "Scan date", ...). Each row is matched to the
 * catalog; a row the matcher isn't sure about becomes the user's own wine
 * rather than being dropped or attached to the wrong one. Every imported row
 * remembers its source, so importing the same file again adds nothing.
 */
import { createHash } from 'node:crypto';
import { createWine } from '../catalog/wines.js';
import { maybeQueueWineImage } from '../catalog/images.js';
import type { Db } from '../db/pool.js';
import { normalize } from '../lib/normalize.js';
import { matchWine } from '../match/matcher.js';
import { createTasting } from '../tastings/tastings.js';

export const MAX_IMPORT_ROWS = 5000;

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes; `,` `;` or tab separated. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const nl = src.search(/\r?\n/);
  const firstLine = nl === -1 ? src : src.slice(0, nl);
  const sep = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

// Column name variants, compared without spaces/punctuation. Community averages
// ("Average rating") are deliberately not a rating column.
const COLUMNS = {
  producer: ['winery', 'producer', 'wineryname', 'maker'],
  name: ['winename', 'wine', 'name', 'cuvee'],
  vintage: ['vintage', 'year'],
  rating: ['yourrating', 'myrating', 'userrating', 'rating'],
  review: ['yourreview', 'review', 'personalnote', 'note', 'notes', 'tastingnote', 'tastingnotes', 'comment'],
  date: ['scandate', 'reviewdate', 'date', 'tastedon', 'drinkdate', 'createdat'],
  region: ['region', 'appellation'],
  country: ['country'],
  type: ['winetype', 'type', 'color', 'colour', 'style'],
  location: ['scanreviewlocation', 'location', 'place'],
  cellar: ['usercellarcount', 'cellarcount', 'quantity', 'bottles', 'count'],
  link: ['linktowine', 'link', 'url', 'vivinourl', 'wineurl'],
} as const;

type Field = keyof typeof COLUMNS;

export function mapColumns(header: string[]): Partial<Record<Field, number>> {
  const keys = header.map(key);
  const out: Partial<Record<Field, number>> = {};
  for (const [field, names] of Object.entries(COLUMNS) as Array<[Field, readonly string[]]>) {
    for (const n of names) {
      const i = keys.indexOf(n);
      if (i >= 0 && !Object.values(out).includes(i)) {
        out[field] = i;
        break;
      }
    }
  }
  return out;
}

export interface VivinoRow {
  producer: string;
  name: string;
  vintage: string | null;
  rating: number | null;
  review: string;
  tastedOn: string | null;
  region: string;
  country: string;
  colour: string;
  location: string;
  bottles: number | null;
  ref: string;
}

const COLOUR: Array<[RegExp, string]> = [[/ros[eé]/i, 'rose'], [/white|blanc/i, 'white'], [/red|rouge/i, 'red']];

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // US month/day/year
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return null;
}

export function readRows(csv: string): { rows: VivinoRow[]; columns: Partial<Record<Field, number>>; total: number } {
  const [header, ...body] = parseCsv(csv);
  if (!header) return { rows: [], columns: {}, total: 0 };
  const columns = mapColumns(header);
  const get = (r: string[], f: Field) => (columns[f] === undefined ? '' : (r[columns[f]!] ?? '').trim());
  const rows: VivinoRow[] = [];
  for (const r of body.slice(0, MAX_IMPORT_ROWS)) {
    const producer = get(r, 'producer');
    const name = get(r, 'name');
    if (!producer && !name) continue;
    const v = get(r, 'vintage');
    const vintage = /^n\.?v\.?$/i.test(v) ? 'NV' : (v.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1] ?? null);
    const rawRating = Number(get(r, 'rating').replace(',', '.'));
    const rating = rawRating >= 0.5 ? Math.min(5, Math.max(0.5, Math.round(rawRating * 2) / 2)) : null;
    const bottles = Number.parseInt(get(r, 'cellar'), 10);
    const typeText = get(r, 'type');
    const colour = COLOUR.find(([re]) => re.test(typeText))?.[1] ?? '';
    const link = get(r, 'link');
    const tastedOn = parseDate(get(r, 'date'));
    const ref = link
      ? `vivino:${link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 200)}:${vintage ?? ''}:${tastedOn ?? ''}`
      : `vivino:${createHash('sha1').update([producer, name, vintage, tastedOn, rating].join('|')).digest('hex').slice(0, 20)}`;
    rows.push({
      producer, name, vintage, rating, review: get(r, 'review'), tastedOn, region: get(r, 'region'), country: get(r, 'country'),
      colour, location: get(r, 'location'), bottles: bottles > 0 ? bottles : null, ref,
    });
  }
  return { rows, columns, total: body.length };
}

export interface ImportSummary {
  rows: number;
  imported: number;
  alreadyImported: number;
  matched: number;
  addedWines: number;
  skipped: number;
  /** Wines added as the user's own because the catalog had no confident match (first 20). */
  addedNames: string[];
  missingColumns: string[];
}

export async function importVivino(db: Db, userId: number, csv: string): Promise<ImportSummary> {
  const { rows, columns, total } = readRows(csv);
  const missingColumns = (['producer', 'name', 'rating'] as Field[]).filter((f) => columns[f] === undefined);
  const summary: ImportSummary = { rows: total, imported: 0, alreadyImported: 0, matched: 0, addedWines: 0, skipped: total - rows.length, addedNames: [], missingColumns };
  if (columns.producer === undefined && columns.name === undefined) return summary;

  const created = new Map<string, number>(); // same wine on several rows -> one new wine
  for (const r of rows) {
    const text = [r.producer, r.name, r.region].filter(Boolean).join(' ');
    let wineId: number;
    const match = await matchWine(db, { text, producer: r.producer || undefined, name: r.name || undefined, colour: r.colour || undefined });
    if (match.outcome === 'auto') {
      wineId = match.candidates[0]!.wine.wine_id;
      summary.matched++;
    } else {
      const k = normalize(`${r.producer} ${r.name}`);
      const existing = created.get(k);
      if (existing) wineId = existing;
      else {
        wineId = await createWine(db, { producer: r.producer || r.name, name: r.producer ? r.name : '', region: r.region, country: r.country, colour: r.colour, source: 'user' });
        created.set(k, wineId);
        summary.addedWines++;
        if (summary.addedNames.length < 20) summary.addedNames.push([r.producer, r.name].filter(Boolean).join(' '));
      }
    }
    const kind = r.bottles && r.rating === null ? 'cellar' : 'tasted';
    const id = await createTasting(db, userId, {
      wineId, vintage: r.vintage, rating: r.rating, notes: r.review.slice(0, 4000), location: r.location.slice(0, 200),
      tastedOn: r.tastedOn ?? undefined, kind, bottles: kind === 'cellar' ? r.bottles : null, externalRef: r.ref,
    });
    if (id === null) summary.alreadyImported++;
    else {
      summary.imported++;
      const { rows: [w] } = await db.query('SELECT wine_id, image_url, image_checked_at FROM wines WHERE wine_id = $1', [wineId]);
      if (w) maybeQueueWineImage(db, w, r.vintage);
    }
  }
  return summary;
}
