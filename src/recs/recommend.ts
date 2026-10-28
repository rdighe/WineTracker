/**
 * Recommendations for a user: wines with a current market price, scored by
 * the user's taste profile.
 *
 * Fewer than MIN_RATED rated tastings -> 'locked': no suggestions at all,
 * since anything we showed wouldn't be personal.
 *
 * Without a style filter the list takes turns between every style the user
 * has liked at least one wine of (red, white, rosé, sparkling, ...), best-liked
 * style first, so one style can't crowd out the rest. With a filter it is the
 * best matches of that style.
 */
import type { Db } from '../db/pool.js';
import { maybeQueueWineImage } from '../catalog/images.js';
import { parseTitle } from '../lib/listing.js';
import { normalize } from '../lib/normalize.js';
import { recStyle, wineCategory, wineFeatures, type RecStyle, type WineNotes, type WineRow } from './features.js';
import { mergeFlavours, textFlavours, type Flavour } from './flavours.js';
import { buildProfile, explain, scoreWine, type Profile } from './profile.js';

export const MIN_RATED = 3;
const PER_PRODUCER = 2;
/** A style counts as liked when one of its wines was rated this high. */
const LIKED_RATING = 3;
/** A liked style with no wine that scores positively still gets its best few. */
const FALLBACK_PER_STYLE = 3;
/** Wines that already have a photo win ties: For you is a page of photos. */
const PHOTO_BONUS = 0.05;

export interface RecOptions {
  limit?: number;
  /** Still reds, still whites, or everything else (rosé, sparkling, sweet, fortified): older app versions. */
  colour?: 'red' | 'white' | 'other';
  /** One style only. */
  style?: RecStyle;
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
  /** red | white | rose | sparkling | orange | sweet, or '' when unknown. */
  style: RecStyle | '';
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

export async function loadProfile(db: Db, userId: number): Promise<{ profile: Profile; tasted: Set<number>; styles: RecStyle[] }> {
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
  // Styles the user liked at least one wine of, best average rating first.
  const byStyle = new Map<RecStyle, { sum: number; n: number; best: number }>();
  for (const r of rows) {
    const st = r.rating == null ? '' : recStyle(wineFeatures(r as WineRow));
    if (!st) continue;
    const s = byStyle.get(st) ?? { sum: 0, n: 0, best: 0 };
    byStyle.set(st, { sum: s.sum + r.rating, n: s.n + 1, best: Math.max(s.best, r.rating) });
  }
  const styles = [...byStyle.entries()].filter(([, s]) => s.best >= LIKED_RATING).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).map(([st]) => st);
  const rated = rows.filter((r) => r.rating != null).map((r) => {
    const features = wineFeatures(r as WineRow, notesOf(r));
    // What the user noted themselves counts most: it is what they tasted.
    const own = Object.fromEntries(Object.keys(textFlavours(...(r.tags ?? []), r.own_notes)).map((k) => [k as Flavour, 1.5]));
    return { features: { ...features, flavours: mergeFlavours(features.flavours ?? {}, own) }, rating: r.rating, priceCents: r.price };
  });
  return { profile: buildProfile(rated), tasted, styles };
}

export type RecResult =
  /** styles: what the user has liked, for the app's filter (best-liked first). */
  | { mode: 'profile'; items: Recommendation[]; styles: RecStyle[] }
  /** Not enough ratings to say anything personal yet: no suggestions, just how far along the user is. */
  | { mode: 'locked'; rated: number; needed: number; items: [] };

export async function recommend(db: Db, userId: number, opts: RecOptions = {}): Promise<RecResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const { profile, tasted, styles } = await loadProfile(db, userId);
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
    `SELECT ${WINE_COLS}, w.image_url, w.image_checked_at, p.median_cents, p.n_merchants, ${NOTES_COLS}
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
      const style = recStyle(f);
      if (opts.style && style !== opts.style) return null;
      const s = scoreWine(profile, f, r.median_cents);
      // Best value: favour cheaper wines among good matches.
      const score = opts.bestValue ? s.score - 0.35 * Math.log(r.median_cents / 1000) : s.score;
      return { r, style, score, rank: score + (r.image_url ? PHOTO_BONUS : 0), reasons: explain(s.contributions) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.rank - a.rank || b.r.n_merchants - a.r.n_merchants);

  let ordered: typeof scored;
  if (opts.colour || opts.style) {
    // One style: its best matches, even when nothing in it matches the profile strongly.
    ordered = scored;
  } else if (styles.length) {
    // Take turns between the styles the user liked, so each shows up near the top.
    const buckets = styles.map((st) => {
      const all = scored.filter((x) => x.style === st);
      const good = all.filter((x) => x.score > 0);
      return good.length ? good : all.slice(0, FALLBACK_PER_STYLE);
    });
    ordered = [];
    for (let i = 0; buckets.some((b) => i < b.length); i++) for (const b of buckets) if (b[i]) ordered.push(b[i]!);
  } else {
    ordered = scored.filter((x) => x.score > 0);
  }

  const perProducer = new Map<string, number>();
  const items: Recommendation[] = [];
  for (const x of ordered) {
    const key = normalize(x.r.producer) || `#${x.r.wine_id}`;
    const n = perProducer.get(key) ?? 0;
    if (n >= PER_PRODUCER) continue;
    perProducer.set(key, n + 1);
    // No photo yet: look for one in the background, so it shows next time.
    if (!x.r.image_url) maybeQueueWineImage(db, x.r);
    items.push(toRec(x.r, x.style, x.score, x.reasons));
    if (items.length >= limit) break;
  }
  return { mode: 'profile', items, styles };
}

function toRec(r: WineRow & { median_cents: number; n_merchants: number; image_url?: string | null }, style: RecStyle | '', score: number, reasons: string[]): Recommendation {
  return {
    wineId: r.wine_id,
    displayName: r.display_name,
    region: r.region,
    country: r.country,
    colour: r.colour ?? '',
    wineType: r.wine_type ?? '',
    style,
    imageUrl: r.image_url ?? null,
    medianCents: r.median_cents,
    nMerchants: r.n_merchants,
    score: Math.round(score * 1000) / 1000,
    reasons,
  };
}
