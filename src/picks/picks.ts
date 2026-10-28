/**
 * Picks: the wines on a restaurant list or a store shelf, ranked for the
 * person's palate.
 *
 *   1. Read: a list's text (the phone reads it off the photos) by a model,
 *      free ones first (readListPages); a shelf photo by a vision model
 *      (readShelfPhoto). Rules read a list when no model answers.
 *   2. Identify: each entry goes through the label matcher. A match brings the
 *      wine's researched notes, the person's own rating if they've had it,
 *      and today's retail price. No match is fine: the entry's own grape,
 *      appellation, colour and heading still describe it (a best guess).
 *   3. Score: the For you taste profile, without its price-range penalty -
 *      restaurant prices aren't retail, and the person picks a price range in
 *      the app, which filters these results on the phone.
 *
 * Markup: a matched wine's list price per bottle (a glass counts as a fifth
 * of one) over its median US retail price. Restaurants usually charge 2.5-3x.
 * On a shelf the same ratio says how the store's price compares with typical
 * retail (below 1 is a good deal).
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { ProviderUnavailableError, type ListEntry, type LlmProvider } from '../llm/types.js';
import { matchLabel } from '../scan/scan.js';
import { wineFeatures, recStyle, type RecStyle, type WineRow } from '../recs/features.js';
import { explain, scoreWine } from '../recs/profile.js';
import { catalogWines, loadProfile, MIN_RATED } from '../recs/recommend.js';
import { MAX_LIST_CHARS, MAX_LIST_ENTRIES } from '../llm/prompts.js';
import { parseListText } from './listText.js';

/** A match this good, short of automatic, is shown as "likely" and scored as that wine. */
const LIKELY = 0.7;
/** Glasses in a bottle, for comparing a glass price with a bottle's. */
const GLASSES_PER_BOTTLE = 5;
/** Matching runs this many entries at a time. */
const CONCURRENCY = 6;

export type PickKind = 'list' | 'shelf';
export type MatchKind = 'matched' | 'likely' | 'guess';

export interface PickItem {
  /** Position on the list or shelf. */
  index: number;
  entry: ListEntry;
  match: MatchKind;
  wineId: number | null;
  displayName: string;
  region: string;
  style: RecStyle | '';
  imageUrl: string | null;
  /** How well it fits the person's palate (relative; null until they've rated a few wines). */
  score: number | null;
  reasons: string[];
  /** The person's best rating of this wine. */
  myRating: number | null;
  /** Median US retail per 750 ml, for the entry's vintage when known, else all vintages. */
  retailCents: number | null;
  retailVintage: string | null;
  /** List (or shelf) price over retail, per bottle and per glass; matched wines only. */
  markup: number | null;
  glassMarkup: number | null;
}

export interface PickResult {
  pickId: number;
  kind: PickKind;
  /** What read it: openrouter | gemini | rules (several joined with '+'); apple from older app versions. */
  source: string;
  /** 'locked' until the person has rated MIN_RATED wines: no scores, best value first. */
  mode: 'profile' | 'locked';
  rated: number;
  items: PickItem[];
}

export const inputSha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');

/** One part of a list for a model: about this many lines (a long list is read in parts, at the same time). */
const PART_LINES = 60;
/** Parts read at once. */
const PART_CONCURRENCY = 4;
const isHeading = (row: string) => /^[^\d$]{3,40}$/.test(row.trim()) && row.trim().split(/\s+/).length <= 5;

/** A page's rows in parts, each starting with the heading in force where it begins. */
function listParts(page: string): string[] {
  const rows = page.split('\n').map((r) => r.trim()).filter(Boolean);
  const out: string[] = [];
  let heading = '';
  for (let i = 0; i < rows.length; i += PART_LINES) {
    const part = rows.slice(i, i + PART_LINES);
    out.push((heading && !isHeading(part[0]!) ? [`${heading}`, ...part] : part).join('\n'));
    for (const r of part) if (isHeading(r)) heading = r;
  }
  return out;
}

/** A model's earlier read of exactly this input, if any. */
async function cachedRead(db: Db, sha: string): Promise<{ entries: ListEntry[]; source: string } | null> {
  const { rows: [r] } = await db.query('SELECT entries, source FROM list_reads WHERE input_sha = $1', [sha]);
  return r ? { entries: r.entries, source: r.source } : null;
}

async function keepRead(db: Db, sha: string, kind: PickKind, source: string, entries: ListEntry[]): Promise<void> {
  await db.query(
    'INSERT INTO list_reads (input_sha, kind, source, entries) VALUES ($1, $2, $3, $4) ON CONFLICT (input_sha) DO NOTHING',
    [sha, kind, source, JSON.stringify(entries)]
  );
}

/** One part of a list: the first reader that answers (free models, then Gemini), else rules. */
async function readPart(db: Db, text: string, readers: LlmProvider[]): Promise<{ entries: ListEntry[]; source: string }> {
  const sha = inputSha(`list:${text}`);
  const cached = await cachedRead(db, sha);
  if (cached) return cached;
  for (const p of readers) {
    if (!p.readWineList) continue;
    try {
      const entries = await p.readWineList(text);
      if (entries.length) {
        await keepRead(db, sha, 'list', p.name, entries);
        return { entries, source: p.name };
      }
    } catch {
      // Busy, rate limited, slow or no key: the next one, then rules.
    }
  }
  return { entries: parseListText(text), source: 'rules' };
}

/**
 * The wines on a list's pages (each page's text as the phone read it off the
 * photo, a line per row). Pages are cut into parts read at the same time; a
 * part read before is reused, so adding a page only reads the new one.
 * source: what read it (openrouter, gemini, rules), several joined with '+'.
 */
export async function readListPages(db: Db, pages: string[], readers: LlmProvider[]): Promise<{ entries: ListEntry[]; source: string }> {
  let budget = MAX_LIST_CHARS;
  const parts: string[] = [];
  for (const page of pages) {
    for (const part of listParts(page)) {
      if (budget <= 0) break;
      parts.push(part.slice(0, budget));
      budget -= part.length;
    }
  }
  const reads = await inBatches(parts, PART_CONCURRENCY, (part) => readPart(db, part, readers));
  return {
    entries: reads.flatMap((r) => r.entries).slice(0, MAX_LIST_ENTRIES),
    source: [...new Set(reads.map((r) => r.source))].join('+'),
  };
}

/**
 * A store shelf photo read by a vision model (free models first, then
 * Gemini), with the text the phone read off it as a hint. The same photo is
 * read once.
 */
export async function readShelfPhoto(
  db: Db, image: Buffer, mimeType: string, phoneText: string | undefined, readers: LlmProvider[]
): Promise<{ entries: ListEntry[]; source: string; sha: string }> {
  const sha = inputSha(image);
  const cached = await cachedRead(db, sha);
  if (cached) return { ...cached, sha };
  let lastErr: unknown = new ProviderUnavailableError('Reading shelf photos is not set up on this server');
  for (const p of readers) {
    if (!p.readShelf) continue;
    try {
      const entries = await p.readShelf(image, mimeType, phoneText);
      await keepRead(db, sha, 'shelf', p.name, entries);
      return { entries, source: p.name, sha };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Colour and style from the heading a wine is listed under. */
function fromSection(section: string): { colour: string; type: string } {
  const s = section.toLowerCase();
  return {
    colour: /\bros[eé]/.test(s) ? 'rose' : /\borange|skin contact/.test(s) ? 'orange' : /\bwhites?\b|\bblanc/.test(s) ? 'white' : /\breds?\b|\brouge/.test(s) ? 'red' : '',
    type: /sparkling|champagne|bubbles|cr[eé]mant|cava|prosecco/.test(s) ? 'sparkling'
      : /dessert|sweet/.test(s) ? 'dessert' : /fortified|\bports?\b|sherry|madeira/.test(s) ? 'fortified' : '',
  };
}

/** A wine nobody has matched, described by what was printed. */
function entryRow(e: ListEntry): WineRow {
  const sec = fromSection(e.section);
  const type = e.style === 'sparkling' ? 'sparkling' : e.style === 'sweet' ? 'dessert' : e.style === 'fortified' ? 'fortified' : sec.type;
  return {
    wine_id: 0,
    // The heading often names the grape ("Pinot Noir") or style.
    display_name: [e.producer, e.name, e.section].filter(Boolean).join(' '),
    producer: e.producer,
    grape: e.grape,
    colour: e.colour || sec.colour,
    wine_type: type,
    region: '',
    sub_region: e.region,
    country: e.country,
  };
}

async function inBatches<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

/** The entries identified and scored for the person, best first. */
export async function scorePicks(db: Db, userId: number | null, entries: ListEntry[]): Promise<Pick<PickResult, 'mode' | 'rated' | 'items'>> {
  // 1. Identify.
  const matches = await inBatches(entries, CONCURRENCY, async (e) => {
    const m = await matchLabel(db, {
      producer: e.producer, name: e.name, vintage: e.vintage, region: e.region, country: e.country, grape: e.grape,
      colour: e.colour, bottleMl: e.bottleMl, rawText: e.text, confidence: 0.8,
    });
    const top = m.candidates[0];
    const match: MatchKind = top && m.outcome === 'auto' ? 'matched' : top && top.score >= LIKELY ? 'likely' : 'guess';
    return { match, wineId: match === 'guess' ? null : top!.wine.wine_id };
  });
  const ids = [...new Set(matches.map((m) => m.wineId).filter((id): id is number => id !== null))];
  const wines = await catalogWines(db, ids);
  const { rows: prices } = ids.length
    ? await db.query(`SELECT wine_id, vintage_key, median_cents FROM wine_prices WHERE wine_id = ANY($1) AND currency = 'USD' AND NOT out_of_stock_only`, [ids])
    : { rows: [] };
  const priceOf = new Map(prices.map((p) => [`${p.wine_id}:${p.vintage_key}`, Number(p.median_cents)]));

  // 2. The person's profile and own ratings.
  const prof = userId ? await loadProfile(db, userId) : null;
  const profile = prof && prof.profile.n >= MIN_RATED ? prof.profile : null;
  const { rows: mine } = userId && ids.length
    ? await db.query('SELECT wine_id, max(rating)::float AS rating FROM tastings WHERE user_id = $1 AND wine_id = ANY($2) AND rating IS NOT NULL GROUP BY wine_id', [userId, ids])
    : { rows: [] };
  const myRating = new Map(mine.map((r) => [Number(r.wine_id), r.rating as number]));

  // 3. Score.
  const items = entries.map((entry, index): PickItem => {
    const { match, wineId } = matches[index]!;
    const wine = wineId ? wines.get(wineId) : undefined;
    const features = wine?.features ?? wineFeatures(entryRow(entry));
    const rated = wineId ? myRating.get(wineId) ?? null : null;
    let score: number | null = null;
    let reasons: string[] = [];
    if (profile) {
      const s = scoreWine(profile, features, null);
      // Their own verdict on this very wine outweighs any guess.
      score = s.score + (rated === null ? 0 : (rated - profile.meanRating) * 0.5);
      reasons = explain(s.contributions);
    }
    if (rated !== null) reasons = [`You rated it ${rated}`, ...reasons].slice(0, 2);
    const vintage = entry.vintage && wineId && priceOf.has(`${wineId}:${entry.vintage}`) ? entry.vintage : null;
    const retail = wineId ? priceOf.get(`${wineId}:${vintage ?? '*'}`) ?? null : null;
    const perBottle = entry.bottleCents === null ? null : (entry.bottleCents * 750) / (entry.bottleMl ?? 750);
    const ratio = (cents: number | null) => (match === 'matched' && retail && cents ? Math.round((cents / retail) * 100) / 100 : null);
    return {
      index,
      entry,
      match,
      wineId,
      displayName: wine?.row.display_name ?? [entry.producer, entry.name].filter(Boolean).join(' '),
      region: wine ? wine.row.sub_region || wine.row.region : entry.region,
      style: wine?.style ?? recStyle(features),
      imageUrl: wine?.row.image_url ?? null,
      score: score === null ? null : Math.round(score * 1000) / 1000,
      reasons,
      myRating: rated,
      retailCents: retail,
      retailVintage: retail === null ? null : vintage ?? '*',
      markup: ratio(perBottle),
      glassMarkup: ratio(entry.glassCents === null ? null : entry.glassCents * GLASSES_PER_BOTTLE),
    };
  });
  // Best fit first; without a profile, the best value (lowest markup) first, then as listed.
  const value = (x: PickItem) => x.markup ?? x.glassMarkup ?? Infinity;
  items.sort((a, b) => (profile ? b.score! - a.score! : value(a) - value(b)) || a.index - b.index);

  return { mode: profile ? 'profile' : 'locked', rated: prof?.profile.n ?? 0, items };
}

/** Score the entries and keep the scan (unsaved until the person saves it). */
export async function pickWines(db: Db, userId: number | null, kind: PickKind, entries: ListEntry[], source: string, sha: string): Promise<PickResult> {
  const scored = await scorePicks(db, userId, entries);
  const { rows: [row] } = await db.query(
    'INSERT INTO pick_scans (user_id, kind, source, input_sha, entries) VALUES ($1, $2, $3, $4, $5) RETURNING pick_id',
    [userId, kind, source, sha, JSON.stringify(entries)]
  );
  return { pickId: Number(row.pick_id), kind, source, ...scored };
}

// ── Saved lists and shelves ────────────────────────────────────────────────

/** Photos kept with a saved list: at most this many, each at most this big (the app sends them shrunk). */
export const MAX_PICK_PHOTOS = 8;
export const MAX_PICK_PHOTO_BYTES = 3 * 1024 * 1024;

export interface SavedPick {
  pickId: number;
  kind: PickKind;
  name: string;
  savedAt: string;
  wines: number;
  photos: number;
  /** The top pick when it was saved. */
  topPick: string;
}

/** Save (or rename) one of the person's scans; its top pick is noted for the saved list. False when it isn't theirs. */
export async function savePick(db: Db, userId: number, pickId: number, name: string): Promise<boolean> {
  const { rows: [p] } = await db.query('SELECT entries FROM pick_scans WHERE pick_id = $1 AND user_id = $2', [pickId, userId]);
  if (!p) return false;
  const { items } = await scorePicks(db, userId, p.entries);
  await db.query(
    `UPDATE pick_scans SET saved = TRUE, name = $3, top_pick = $4, saved_at = COALESCE(saved_at, NOW()) WHERE pick_id = $1 AND user_id = $2`,
    [pickId, userId, name, items[0]?.displayName ?? '']
  );
  return true;
}

/** Replace a scan's photos. False when it isn't the person's. */
export async function setPickPhotos(db: Db, userId: number, pickId: number, photos: { contentType: string; bytes: Buffer }[]): Promise<boolean> {
  const { rows: [p] } = await db.query('SELECT 1 FROM pick_scans WHERE pick_id = $1 AND user_id = $2', [pickId, userId]);
  if (!p) return false;
  await db.query('DELETE FROM pick_photos WHERE pick_id = $1', [pickId]);
  for (const [n, ph] of photos.slice(0, MAX_PICK_PHOTOS).entries()) {
    await db.query('INSERT INTO pick_photos (pick_id, n, content_type, bytes) VALUES ($1, $2, $3, $4)', [pickId, n, ph.contentType, ph.bytes]);
  }
  return true;
}

export async function listSavedPicks(db: Db, userId: number): Promise<SavedPick[]> {
  const { rows } = await db.query(
    `SELECT p.pick_id, p.kind, p.name, p.saved_at, jsonb_array_length(p.entries) AS wines, p.top_pick,
            (SELECT count(*)::int FROM pick_photos ph WHERE ph.pick_id = p.pick_id) AS photos
       FROM pick_scans p WHERE p.user_id = $1 AND p.saved ORDER BY p.saved_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    pickId: Number(r.pick_id), kind: r.kind, name: r.name, savedAt: new Date(r.saved_at).toISOString(),
    wines: Number(r.wines), photos: r.photos, topPick: r.top_pick,
  }));
}

/** A saved (or recent) scan, scored again for the person's palate as it is now. */
export async function openPick(db: Db, userId: number, pickId: number): Promise<(PickResult & { name: string; saved: boolean; photos: number }) | null> {
  const { rows: [p] } = await db.query(
    `SELECT kind, source, entries, saved, name, (SELECT count(*)::int FROM pick_photos ph WHERE ph.pick_id = p.pick_id) AS photos
       FROM pick_scans p WHERE pick_id = $1 AND user_id = $2`,
    [pickId, userId]
  );
  if (!p) return null;
  return { pickId, kind: p.kind, source: p.source, name: p.name, saved: p.saved, photos: p.photos, ...(await scorePicks(db, userId, p.entries)) };
}

export async function pickPhoto(db: Db, userId: number, pickId: number, n: number): Promise<{ contentType: string; bytes: Buffer } | null> {
  const { rows: [ph] } = await db.query(
    `SELECT ph.content_type, ph.bytes FROM pick_photos ph JOIN pick_scans p USING (pick_id) WHERE ph.pick_id = $1 AND ph.n = $2 AND p.user_id = $3`,
    [pickId, n, userId]
  );
  return ph ? { contentType: ph.content_type, bytes: ph.bytes } : null;
}

/** Unsave a scan: it goes, photos and all. False when it isn't the person's. */
export async function deletePick(db: Db, userId: number, pickId: number): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM pick_scans WHERE pick_id = $1 AND user_id = $2', [pickId, userId]);
  return Boolean(rowCount);
}
