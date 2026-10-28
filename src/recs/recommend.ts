/**
 * Recommendations for a user: wines with a current market price, scored by
 * the user's taste profile.
 *
 * Fewer than MIN_RATED rated tastings -> 'locked': no suggestions at all,
 * since anything we showed wouldn't be personal.
 */
import type { Db } from '../db/pool.js';
import { parseTitle } from '../lib/listing.js';
import { normalize } from '../lib/normalize.js';
import { wineCategory, wineFeatures, type WineNotes, type WineRow } from './features.js';
import { mergeFlavours, textFlavours, type Flavour } from './flavours.js';
import { buildProfile, explain, scoreWine, type Profile } from './profile.js';

export const MIN_RATED = 3;
const PER_PRODUCER = 2;

export interface RecOptions {
  limit?: number;
  /** Still reds, still whites, or everything else (rosé, sparkling, sweet, fortified). */
  colour?: 'red' | 'white' | 'other';
  maxPriceCents?: number;
  bestValue?: boolean;
}

export interface Recommendation {
  wineId: number;
  displayName: string;
  region: string;
  country: string;
  /** Still or other style, and a reference photo (a shop's packshot), for the app's photo-first cards. */
  colour: string;
  wineType: string;
  imageUrl: string | null;
  medianCents: number;
  nMerchants: number;
  score: number;
  reasons: string[];
}

const WINE_COLS = `w.wine_id, w.display_name, w.producer, w.grape, w.colour, w.wine_type, w.region, w.sub_region, w.country`;
// Researched notes (src/catalog/info.ts), when the wine has them.
const NOTES_COLS = `i.info->'descriptors' AS descriptors,
  concat_ws(' ', i.info->'tastingNotes'->>'nose', i.info->'tastingNotes'->>'palate', i.info->'tastingNotes'->>'finish') AS notes_text`;
const NOTES_JOIN = `LEFT JOIN wine_info i ON i.wine_id = w.wine_id AND i.status = 'ready'`;

const notesOf = (r: { descriptors?: unknown; notes_text?: string | null }): WineNotes | null =>
  Array.isArray(r.descriptors) || r.notes_text ? { descriptors: Array.isArray(r.descriptors) ? r.descriptors.map(String) : [], text: r.notes_text ?? '' } : null;

export async function loadProfile(db: Db, userId: number): Promise<{ profile: Profile; tasted: Set<number> }> {
  const { rows } = await db.query(
    `SELECT ${WINE_COLS}, t.rating::float AS rating, t.tags, t.notes AS own_notes, ${NOTES_COLS},
            COALESCE(p.median_cents, CASE WHEN t.price_paid_cents IS NOT NULL THEN round(t.price_paid_cents * 750.0 / t.bottle_ml)::int END) AS price
       FROM tastings t JOIN wines w USING (wine_id)
       LEFT JOIN wine_prices p ON p.wine_id = t.wine_id AND p.vintage_key = '*' AND p.currency = 'USD'
       ${NOTES_JOIN}
      WHERE t.user_id = $1`,
    [userId]
  );
  const tasted = new Set<number>(rows.map((r) => r.wine_id));
  const rated = rows.filter((r) => r.rating != null).map((r) => {
    const features = wineFeatures(r as WineRow, notesOf(r));
    // What the user noted themselves counts most: it is what they tasted.
    const own = Object.fromEntries(Object.keys(textFlavours(...(r.tags ?? []), r.own_notes)).map((k) => [k as Flavour, 1.5]));
    return { features: { ...features, flavours: mergeFlavours(features.flavours ?? {}, own) }, rating: r.rating, priceCents: r.price };
  });
  return { profile: buildProfile(rated), tasted };
}

export type RecResult =
  | { mode: 'profile'; items: Recommendation[] }
  /** Not enough ratings to say anything personal yet: no suggestions, just how far along the user is. */
  | { mode: 'locked'; rated: number; needed: number; items: [] };

export async function recommend(db: Db, userId: number, opts: RecOptions = {}): Promise<RecResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const { profile, tasted } = await loadProfile(db, userId);
  // Only wines a shop has in stock.
  const filters: string[] = [`p.vintage_key = '*'`, `p.currency = 'USD'`, `NOT p.out_of_stock_only`];
  const params: unknown[] = [];
  if (opts.maxPriceCents) {
    params.push(opts.maxPriceCents);
    filters.push(`p.median_cents <= $${params.length}`);
  }

  if (profile.n < MIN_RATED) return { mode: 'locked', rated: profile.n, needed: MIN_RATED, items: [] };

  // Every priced wine is a candidate (tens of thousands - scoring them in
  // memory is ~100 ms). Move this to a precomputed table if the catalog grows
  // past a few hundred thousand priced wines.
  const { rows } = await db.query(
    `SELECT ${WINE_COLS}, w.image_url, p.median_cents, p.n_merchants, ${NOTES_COLS}
       FROM wine_prices p JOIN wines w USING (wine_id)
       ${NOTES_JOIN}
      WHERE ${filters.join(' AND ')}`,
    params
  );

  const scored = rows
    // Shops also sell spirits, beer and water; some of those ended up in the catalog.
    .filter((r) => !tasted.has(r.wine_id) && parseTitle(r.display_name).isWine)
    .map((r) => {
      const f = wineFeatures(r as WineRow, notesOf(r));
      if (opts.colour && wineCategory(f) !== opts.colour) return null;
      const s = scoreWine(profile, f, r.median_cents);
      // Best value: favour cheaper wines among good matches.
      const score = opts.bestValue ? s.score - 0.35 * Math.log(r.median_cents / 1000) : s.score;
      return { r, score, reasons: explain(s.contributions) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.n_merchants - a.r.n_merchants);

  const perProducer = new Map<string, number>();
  const items: Recommendation[] = [];
  for (const x of scored) {
    const key = normalize(x.r.producer) || `#${x.r.wine_id}`;
    const n = perProducer.get(key) ?? 0;
    if (n >= PER_PRODUCER) continue;
    perProducer.set(key, n + 1);
    items.push(toRec(x.r, x.score, x.reasons));
    if (items.length >= limit) break;
  }
  return { mode: 'profile', items };
}

function toRec(r: WineRow & { median_cents: number; n_merchants: number; image_url?: string | null }, score: number, reasons: string[]): Recommendation {
  return {
    wineId: r.wine_id,
    displayName: r.display_name,
    region: r.region,
    country: r.country,
    colour: r.colour ?? '',
    wineType: r.wine_type ?? '',
    imageUrl: r.image_url ?? null,
    medianCents: r.median_cents,
    nMerchants: r.n_merchants,
    score: Math.round(score * 1000) / 1000,
    reasons,
  };
}
