/**
 * Picks: the wines on a restaurant list or a store shelf, ranked for the
 * person's palate.
 *
 *   1. Read: the entries come from the phone (Apple Intelligence), and/or are
 *      read here from the list's text it couldn't (readListEntries).
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
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import type { ListEntry, LlmProvider } from '../llm/types.js';
import { matchLabel } from '../scan/scan.js';
import { wineFeatures, recStyle, type RecStyle, type WineRow } from '../recs/features.js';
import { explain, scoreWine } from '../recs/profile.js';
import { catalogWines, loadProfile, MIN_RATED } from '../recs/recommend.js';
import { MAX_LIST_CHARS } from '../llm/prompts.js';
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
  /** What read the list: apple | gemini | openrouter | rules, or the provider for a shelf. */
  source: string;
  /** 'locked' until the person has rated MIN_RATED wines: no scores, best value first. */
  mode: 'profile' | 'locked';
  rated: number;
  items: PickItem[];
}

export const inputSha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');

/**
 * Read a list's text into entries on the server, for phones without Apple
 * Intelligence (or the parts it couldn't read): a model when one answers (the
 * main provider, then OpenRouter's free models), else rules. The same text
 * read before by a model is reused.
 */
export async function readListEntries(db: Db, text: string, providers: (LlmProvider | null)[]): Promise<{ entries: ListEntry[]; source: string }> {
  const clipped = text.slice(0, MAX_LIST_CHARS);
  const sha = inputSha(clipped);
  const { rows: [cached] } = await db.query(
    // Only what a server model read from this text alone (not rules, not the phone's part of a list).
    `SELECT entries, source FROM pick_scans WHERE input_sha = $1 AND kind = 'list' AND source NOT IN ('rules', 'apple') AND source NOT LIKE '%+%'
      ORDER BY created_at DESC LIMIT 1`,
    [sha]
  );
  if (cached) return { entries: cached.entries, source: cached.source };
  for (const p of providers) {
    if (!p?.readWineList) continue;
    try {
      const entries = await p.readWineList(clipped);
      if (entries.length) return { entries, source: p.name };
    } catch {
      // Busy, rate limited or no key: the next one, then rules.
    }
  }
  return { entries: parseListText(clipped), source: 'rules' };
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

export async function pickWines(db: Db, userId: number | null, kind: PickKind, entries: ListEntry[], source: string, sha: string): Promise<PickResult> {
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

  const { rows: [saved] } = await db.query(
    'INSERT INTO pick_scans (user_id, kind, source, input_sha, entries) VALUES ($1, $2, $3, $4, $5) RETURNING pick_id',
    [userId, kind, source, sha, JSON.stringify(entries)]
  );
  return { pickId: Number(saved.pick_id), kind, source, mode: profile ? 'profile' : 'locked', rated: prof?.profile.n ?? 0, items };
}
