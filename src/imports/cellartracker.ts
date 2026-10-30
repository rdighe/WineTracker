/**
 * Import from CellarTracker, through its export address (xlquery.asp), which
 * takes the person's CellarTracker handle and password: they're sent to
 * CellarTracker for this import only, never stored or logged. The same
 * tables, downloaded by hand from CellarTracker as CSV, can be uploaded
 * instead; which table a file is comes from its columns.
 *
 *   collection  Inventory: each bottle, with its location and bin -> cellar entries
 *   pending     Pending: bottles bought, not delivered yet -> cellar entries tagged "on order"
 *   wishlist    Tag: wines on a list whose name says "wish" -> Saved
 *   notes       Notes: their tasting notes, 100-point scores as stars -> tastings
 *   history     Consumed: bottles they drank -> tastings (unless a note covers that day)
 *
 * Every entry remembers where it came from (external_ref), so importing again
 * adds only what's new.
 */
import type { Db } from '../db/pool.js';
import { createTasting } from '../tastings/tastings.js';
import { maybeQueueWineImage } from '../catalog/images.js';
import { cellarForNew } from '../cellars/cellars.js';
import { parseCsv } from './vivino.js';
import { WineResolver } from './resolve.js';

export const CT_PARTS = ['collection', 'pending', 'wishlist', 'notes', 'history'] as const;
export type CtPart = (typeof CT_PARTS)[number];
const TABLE: Record<CtPart, string> = { collection: 'Inventory', pending: 'Pending', wishlist: 'Tag', notes: 'Notes', history: 'Consumed' };
const MAX_ROWS = 20000;
const FETCH_TIMEOUT_MS = 60_000;

export class CellarTrackerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** One table from CellarTracker's export address, as text (it answers in Windows-1252). */
export async function fetchCellarTracker(handle: string, password: string, part: CtPart, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = `https://www.cellartracker.com/xlquery.asp?User=${encodeURIComponent(handle)}&Password=${encodeURIComponent(password)}&Format=csv&Table=${TABLE[part]}&Location=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': 'WineTracker import' } });
  } catch {
    // Never the URL: it holds the password.
    throw new CellarTrackerError(502, "Couldn't reach CellarTracker. Try again in a few minutes.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new CellarTrackerError(502, `CellarTracker answered ${res.status}. Try again in a few minutes.`);
  const text = new TextDecoder('windows-1252').decode(await res.arrayBuffer());
  // Wrong handle or password: a web page or a sign-in message, not a table.
  if (!/\biWine\b/.test(text.slice(0, 2000))) {
    if (/<html|log ?in|password|not logged/i.test(text.slice(0, 4000))) {
      throw new CellarTrackerError(401, "CellarTracker didn't accept that handle and password. Use your handle (not your email) and check the password.");
    }
    return '';
  }
  return text;
}

/** Which table an uploaded CellarTracker file is, from its columns. */
export function detectPart(csv: string): CtPart | null {
  const header = (csv.split(/\r?\n/, 1)[0] ?? '').toLowerCase();
  if (/\bilistname\b|\blistname\b/.test(header)) return 'wishlist';
  if (/\binote\b/.test(header)) return 'notes';
  if (/\biconsumed\b/.test(header)) return 'history';
  if (/\bipurchase\b/.test(header) && /\bdelivered\b|\bdeliverydate\b/.test(header)) return 'pending';
  if (/\biinventory\b|\bbarcode\b/.test(header) || (/\bbin\b/.test(header) && /\blocation\b/.test(header))) return 'collection';
  return null;
}

type Row = Record<string, string>;

/** Rows keyed by lowercased column name. */
function rowsOf(csv: string): Row[] {
  const [header, ...body] = parseCsv(csv.replace(/^﻿/, ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.slice(0, MAX_ROWS).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** A CellarTracker score (50-100) as stars, in tenths: 92 -> 4.2, 96+ -> 5. Five-star scores stay as they are. */
export function starsFromScore(raw: string): number | null {
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 5) return Math.max(0.1, Math.round(n * 10) / 10);
  // 80 points is 3 stars, 90 is 4, 96 and up 5; under 80 falls away faster (a flawed wine).
  const stars = n >= 96 ? 5 : n >= 80 ? 3 + (n - 80) / 10 : Math.max(0.5, 3 - (80 - n) / 5);
  return Math.round(Math.min(5, stars) * 10) / 10;
}

const vintageOf = (v: string) => (/^(1[89]\d\d|20\d\d)$/.test(v) ? v : /^(nv|n\.v\.|1001)$/i.test(v) ? 'NV' : null);
const colourOf = (r: Row) => {
  const c = `${r.color ?? ''} ${r.type ?? ''}`.toLowerCase();
  return /ros[eé]/.test(c) ? 'rose' : /white/.test(c) ? 'white' : /red/.test(c) ? 'red' : '';
};
const typeOf = (r: Row) => {
  const c = `${r.category ?? ''} ${r.type ?? ''}`.toLowerCase();
  return /sparkling/.test(c) ? 'sparkling' : /fortified/.test(c) ? 'fortified' : /sweet|dessert/.test(c) ? 'dessert' : '';
};
const mlOf = (size: string) => {
  const s = size.toLowerCase().replace(/\s/g, '');
  const m = s.match(/^([\d.]+)(ml|l|cl)$/);
  if (!m) return 750;
  const n = Number(m[1]) * (m[2] === 'l' ? 1000 : m[2] === 'cl' ? 10 : 1);
  return n >= 50 && n <= 30000 ? Math.round(n) : 750;
};
/** CellarTracker dates are month/day/year. */
const dateOf = (s: string) => {
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
};
const priceOf = (r: Row) => {
  const n = Number((r.price || r.nativeprice || '').replace(/[^0-9.]/g, ''));
  return n > 0 && n < 100000 ? n : null;
};
/** The wine as CellarTracker names it: "Wine" usually starts with the producer. */
const wineOf = (r: Row) => {
  const producer = r.producer ?? '';
  const full = r.wine ?? '';
  const name = producer && full.toLowerCase().startsWith(producer.toLowerCase()) ? full.slice(producer.length).trim() : full;
  return { producer, name: name || full, region: r.appellation || r.subregion || r.region || '', country: r.country ?? '', colour: colourOf(r), grape: r.varietal ?? '', wineType: typeOf(r) };
};
/** Today and earlier only: tastings can't be in the future. */
const past = (d: string | undefined) => (d && d <= new Date().toISOString().slice(0, 10) ? d : undefined);

export interface CtPartSummary { rows: number; imported: number; alreadyImported: number; bottles?: number }
export interface CtSummary {
  parts: Partial<Record<CtPart, CtPartSummary>>;
  matched: number;
  addedWines: number;
  addedNames: string[];
}

/** Import the tables given (CSV text by part) into the person's account; bottles go into `cellarId` (default: their first cellar). */
export async function importCellarTracker(db: Db, userId: number, tables: Partial<Record<CtPart, string>>, opts: { cellarId?: number | null } = {}): Promise<CtSummary> {
  const wines = new WineResolver(db);
  const parts: CtSummary['parts'] = {};
  const cellarId = tables.collection || tables.pending ? await cellarForNew(db, userId, opts.cellarId) : null;
  const queue = async (wineId: number, vintage: string | null) => {
    const { rows: [w] } = await db.query('SELECT wine_id, image_url, image_checked_at FROM wines WHERE wine_id = $1', [wineId]);
    if (w) maybeQueueWineImage(db, w, vintage);
  };

  if (tables.collection) {
    // One entry per wine, vintage, size and place, with however many bottles are there.
    const groups = new Map<string, { r: Row; n: number }>();
    for (const r of rowsOf(tables.collection)) {
      if (!r.wine && !r.producer) continue;
      const k = [r.iwine, r.vintage, r.size, r.location, r.bin].join('|');
      const g = groups.get(k);
      if (g) g.n++;
      else groups.set(k, { r, n: 1 });
    }
    const s: CtPartSummary = { rows: 0, imported: 0, alreadyImported: 0, bottles: 0 };
    for (const [k, { r, n }] of groups) {
      s.rows += n;
      const wineId = await wines.resolve(wineOf(r));
      const vintage = vintageOf(r.vintage ?? '');
      const id = await createTasting(db, userId, {
        wineId, vintage, kind: 'cellar', bottles: n, cellarId, pricePaid: priceOf(r), bottleMl: mlOf(r.size ?? ''),
        location: [r.location, r.bin].filter(Boolean).join(' · ').slice(0, 200), tastedOn: past(dateOf(r.purchasedate ?? '')),
        externalRef: `ct:inv:${k}`.slice(0, 300),
      });
      if (id === null) s.alreadyImported++;
      else {
        s.imported++;
        s.bottles! += n;
        void queue(wineId, vintage);
      }
    }
    parts.collection = s;
  }

  if (tables.pending) {
    const s: CtPartSummary = { rows: 0, imported: 0, alreadyImported: 0, bottles: 0 };
    for (const r of rowsOf(tables.pending)) {
      if ((!r.wine && !r.producer) || /^(true|yes|1)$/i.test(r.delivered ?? '')) continue;
      s.rows++;
      const n = Number.parseInt(r.remaining || r.quantity || '1', 10);
      if (!(n > 0)) continue;
      const wineId = await wines.resolve(wineOf(r));
      const vintage = vintageOf(r.vintage ?? '');
      const id = await createTasting(db, userId, {
        wineId, vintage, kind: 'cellar', bottles: n, cellarId, pricePaid: priceOf(r), bottleMl: mlOf(r.size ?? ''), tags: ['on order'],
        location: r.storename ? `On order from ${r.storename}`.slice(0, 200) : 'On order', tastedOn: past(dateOf(r.purchasedate ?? '')),
        externalRef: `ct:pending:${r.ipurchase || [r.iwine, r.vintage, r.purchasedate].join('|')}`,
      });
      if (id === null) s.alreadyImported++;
      else {
        s.imported++;
        s.bottles! += n;
      }
    }
    parts.pending = s;
  }

  if (tables.wishlist) {
    const s: CtPartSummary = { rows: 0, imported: 0, alreadyImported: 0 };
    for (const r of rowsOf(tables.wishlist)) {
      if ((!r.wine && !r.producer) || !/wish/i.test(r.listname ?? r.ilistname ?? 'wishlist')) continue;
      s.rows++;
      const wineId = await wines.resolve(wineOf(r));
      const vintage = vintageOf(r.vintage ?? '') ?? '*';
      const { rowCount } = await db.query('INSERT INTO saved_wines (user_id, wine_id, vintage_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, wineId, vintage]);
      if (rowCount) s.imported++;
      else s.alreadyImported++;
    }
    parts.wishlist = s;
  }

  // Days a note covers (wine and date), so drinking history doesn't log the same bottle twice.
  const noted = new Set<string>();
  if (tables.notes) {
    const s: CtPartSummary = { rows: 0, imported: 0, alreadyImported: 0 };
    for (const r of rowsOf(tables.notes)) {
      if (!r.wine && !r.producer) continue;
      s.rows++;
      const wineId = await wines.resolve(wineOf(r));
      const vintage = vintageOf(r.vintage ?? '');
      const tastedOn = past(dateOf(r.tastingdate ?? ''));
      noted.add(`${r.iwine}|${tastedOn ?? ''}`);
      const id = await createTasting(db, userId, {
        wineId, vintage, rating: starsFromScore(r.rating ?? ''), notes: (r.tastingnotes ?? '').slice(0, 4000), tastedOn,
        externalRef: `ct:note:${r.inote || [r.iwine, r.vintage, r.tastingdate].join('|')}`,
      });
      if (id === null) s.alreadyImported++;
      else {
        s.imported++;
        void queue(wineId, vintage);
      }
    }
    parts.notes = s;
  }

  if (tables.history) {
    const s: CtPartSummary = { rows: 0, imported: 0, alreadyImported: 0 };
    for (const r of rowsOf(tables.history)) {
      if (!r.wine && !r.producer) continue;
      s.rows++;
      const tastedOn = past(dateOf(r.consumed ?? ''));
      if (noted.has(`${r.iwine}|${tastedOn ?? ''}`)) continue;
      const wineId = await wines.resolve(wineOf(r));
      const id = await createTasting(db, userId, {
        wineId, vintage: vintageOf(r.vintage ?? ''), notes: (r.consumptionnote ?? '').slice(0, 4000), tastedOn, bottleMl: mlOf(r.size ?? ''),
        externalRef: `ct:consumed:${r.iconsumed || [r.iwine, r.vintage, r.consumed].join('|')}`,
      });
      if (id === null) s.alreadyImported++;
      else s.imported++;
    }
    parts.history = s;
  }

  return { parts, matched: wines.matched, addedWines: wines.added, addedNames: wines.addedNames };
}
