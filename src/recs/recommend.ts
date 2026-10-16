/**
 * Recommendations for a user: wines with a current market price, scored by
 * the user's taste profile.
 *
 * Fewer than MIN_RATED rated tastings -> 'locked': no suggestions at all,
 * since anything we showed wouldn't be personal.
 */
import type { Db } from '../db/pool.js';
import { normalize } from '../lib/normalize.js';
import { wineFeatures, type WineRow } from './features.js';
import { buildProfile, explain, scoreWine, type Profile } from './profile.js';

export const MIN_RATED = 3;
const PER_PRODUCER = 2;

export interface RecOptions {
  limit?: number;
  colour?: 'red' | 'white' | 'rose';
  maxPriceCents?: number;
  bestValue?: boolean;
}

export interface Recommendation {
  wineId: number;
  displayName: string;
  region: string;
  country: string;
  medianCents: number;
  nMerchants: number;
  score: number;
  reasons: string[];
}

const WINE_COLS = `w.wine_id, w.display_name, w.producer, w.grape, w.colour, w.wine_type, w.region, w.sub_region, w.country`;

export async function loadProfile(db: Db, userId: number): Promise<{ profile: Profile; tasted: Set<number> }> {
  const { rows } = await db.query(
    `SELECT ${WINE_COLS}, t.rating::float AS rating,
            COALESCE(p.median_cents, CASE WHEN t.price_paid_cents IS NOT NULL THEN round(t.price_paid_cents * 750.0 / t.bottle_ml)::int END) AS price
       FROM tastings t JOIN wines w USING (wine_id)
       LEFT JOIN wine_prices p ON p.wine_id = t.wine_id AND p.vintage_key = '*' AND p.currency = 'USD'
      WHERE t.user_id = $1`,
    [userId]
  );
  const tasted = new Set<number>(rows.map((r) => r.wine_id));
  const rated = rows.filter((r) => r.rating != null).map((r) => ({ features: wineFeatures(r as WineRow), rating: r.rating, priceCents: r.price }));
  return { profile: buildProfile(rated), tasted };
}

export type RecResult =
  | { mode: 'profile'; items: Recommendation[] }
  /** Not enough ratings to say anything personal yet: no suggestions, just how far along the user is. */
  | { mode: 'locked'; rated: number; needed: number; items: [] };

export async function recommend(db: Db, userId: number, opts: RecOptions = {}): Promise<RecResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const { profile, tasted } = await loadProfile(db, userId);
  const filters: string[] = [`p.vintage_key = '*'`, `p.currency = 'USD'`];
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
    `SELECT ${WINE_COLS}, p.median_cents, p.n_merchants FROM wine_prices p JOIN wines w USING (wine_id)
      WHERE ${filters.join(' AND ')}`,
    params
  );

  const scored = rows
    .filter((r) => !tasted.has(r.wine_id))
    .map((r) => {
      const f = wineFeatures(r as WineRow);
      if (opts.colour && f.colour !== opts.colour) return null;
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

function toRec(r: WineRow & { median_cents: number; n_merchants: number }, score: number, reasons: string[]): Recommendation {
  return {
    wineId: r.wine_id,
    displayName: r.display_name,
    region: r.region,
    country: r.country,
    medianCents: r.median_cents,
    nMerchants: r.n_merchants,
    score: Math.round(score * 1000) / 1000,
    reasons,
  };
}
