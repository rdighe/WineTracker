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
import { recStyle, wineCategory, wineFeatures, type Features, type RecStyle, type WineNotes, type WineRow } from './features.js';
import { flavorLabel, mergeFlavors, textFlavors, type Flavor, type FlavorProfile } from './flavors.js';
import { buildProfile, explain, scoreWine, type Profile, type RatedWine } from './profile.js';
import { currentNoteFlavors, noteHash, ownFlavorWeights, type NoteFlavorReader } from '../tastings/noteFlavors.js';
import type { Near, Places, Reach } from '../places/places.js';

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
  /** A search ("Find wines"): any of these styles, a price range, a region, wanted tasting notes and food. */
  styles?: RecStyle[];
  minPriceCents?: number;
  region?: string;
  notes?: string;
  food?: string;
  /** Only wines a shop near the person has, or ships to them; everything when none do. */
  near?: Near;
  places?: Places;
  /** Reads rated notes no model has read yet, in the background, so they count next time. */
  noteReader?: Pick<NoteFlavorReader, 'request'>;
}

/** How a location-aware request went: applied false when no shop near the person had any match. */
export interface NearResult { applied: boolean; state: string; pending: number }

/** What the suggestions are based on, so the app can say so. */
export interface ProfileSummary {
  rated: number;
  /** Styles liked, best-liked first. */
  styles: RecStyle[];
  /** The price band the user usually rates in, per 750 ml. */
  priceLowCents: number | null;
  priceHighCents: number | null;
  /** Flavor families the user likes most (from tasting notes, tags and the wines' notes). */
  flavors: string[];
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
  /** With a location: the closest way to get it (a store nearby, or a shop that ships there). */
  nearby?: { shop: string; local: boolean; miles: number | null; city: string; ships: boolean };
  medianCents: number;
  nMerchants: number;
  score: number;
  reasons: string[];
}

const WINE_COLS = `w.wine_id, w.display_name, w.producer, w.grape, w.colour, w.wine_type, w.region, w.sub_region, w.country`;
// Researched notes (src/catalog/info.ts), when the wine has them.
const NOTES_COLS = `i.info->'descriptors' AS descriptors, i.info->'foodPairings' AS food_pairings,
  concat_ws(' ', i.info->'tastingNotes'->>'nose', i.info->'tastingNotes'->>'palate', i.info->'tastingNotes'->>'finish') AS notes_text`;
const NOTES_JOIN = `LEFT JOIN wine_info i ON i.wine_id = w.wine_id AND i.status = 'ready'`;

const notesOf = (r: { descriptors?: unknown; notes_text?: string | null }): WineNotes | null =>
  Array.isArray(r.descriptors) || r.notes_text ? { descriptors: Array.isArray(r.descriptors) ? r.descriptors.map(String) : [], text: r.notes_text ?? '' } : null;

/** A rated tasting, as the profile and the evaluation (scripts/eval-recs.ts) see it. */
export interface RatedTasting {
  tastingId: number;
  wineId: number;
  rating: number;
  /** Market price per 750 ml, else what was paid. */
  priceCents: number | null;
  /** The wine as anyone sees it: catalog fields and researched notes. */
  features: Features;
  style: RecStyle | '';
  /** Flavors in the person's own notes and tags by keyword, and as read by a model (null: not read yet, or nothing written). */
  own: { keywords: FlavorProfile; read: FlavorProfile | null; hasText: boolean };
}

/** Which of the person's own flavors count: as read by a model (keywords until then), keywords only, or none. */
export type OwnFlavors = 'read' | 'keywords' | 'none';

/** Every rated tasting of the user, with what the profile needs. */
export async function loadRatedTastings(db: Db, userId: number): Promise<{ rated: RatedTasting[]; tasted: Set<number> }> {
  const { rows } = await db.query(
    `SELECT ${WINE_COLS}, t.tasting_id, t.rating::float AS rating, t.tags, t.notes, t.note_flavors, t.note_flavors_for, ${NOTES_COLS},
            COALESCE(p.median_cents, CASE WHEN t.price_paid_cents IS NOT NULL THEN round(t.price_paid_cents * 750.0 / t.bottle_ml)::int END) AS price
       FROM tastings t JOIN wines w USING (wine_id)
       LEFT JOIN wine_prices p ON p.wine_id = t.wine_id AND p.vintage_key = '*' AND p.currency = 'USD'
       ${NOTES_JOIN}
      WHERE t.user_id = $1`,
    [userId]
  );
  const tasted = new Set<number>(rows.map((r) => r.wine_id));
  const rated = rows.filter((r) => r.rating != null).map((r): RatedTasting => {
    const features = wineFeatures(r as WineRow, notesOf(r));
    const read = currentNoteFlavors(r);
    return {
      tastingId: Number(r.tasting_id),
      wineId: Number(r.wine_id),
      rating: r.rating,
      priceCents: r.price,
      features,
      style: recStyle(features),
      own: {
        // What the user noted themselves counts most: it is what they tasted.
        keywords: Object.fromEntries(Object.keys(textFlavors(...(r.tags ?? []), r.notes)).map((k) => [k, 1.5])) as FlavorProfile,
        read: read ? ownFlavorWeights(read) : null,
        hasText: Boolean(noteHash(r.notes, r.tags)),
      },
    };
  });
  return { rated, tasted };
}

/** A rated tasting as a profile input, with the person's own flavors added to the wine's. */
export function ratedWine(t: RatedTasting, own: OwnFlavors = 'read'): RatedWine {
  const mine = own === 'none' ? {} : own === 'keywords' ? t.own.keywords : t.own.read ?? t.own.keywords;
  return { features: { ...t.features, flavors: mergeFlavors(t.features.flavors ?? {}, mine) }, rating: t.rating, priceCents: t.priceCents };
}

/** Styles the user liked at least one wine of, best average rating first. */
export function likedStyles(rated: RatedTasting[]): RecStyle[] {
  const byStyle = new Map<RecStyle, { sum: number; n: number; best: number }>();
  for (const r of rated) {
    if (!r.style) continue;
    const s = byStyle.get(r.style) ?? { sum: 0, n: 0, best: 0 };
    byStyle.set(r.style, { sum: s.sum + r.rating, n: s.n + 1, best: Math.max(s.best, r.rating) });
  }
  return [...byStyle.entries()].filter(([, s]) => s.best >= LIKED_RATING).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).map(([st]) => st);
}

/** unread: rated tastings whose notes no model has read yet (src/tastings/noteFlavors.ts). */
export async function loadProfile(db: Db, userId: number): Promise<{ profile: Profile; tasted: Set<number>; styles: RecStyle[]; unread: number[] }> {
  const { rated, tasted } = await loadRatedTastings(db, userId);
  return {
    profile: buildProfile(rated.map((t) => ratedWine(t))),
    tasted,
    styles: likedStyles(rated),
    unread: rated.filter((t) => t.own.hasText && !t.own.read).map((t) => t.tastingId),
  };
}

/** Catalog wines with their profile features (researched notes included) and photo, by id. */
export async function catalogWines(db: Db, wineIds: number[]): Promise<Map<number, { row: WineRow & { image_url: string | null }; features: Features; style: RecStyle | '' }>> {
  if (!wineIds.length) return new Map();
  const { rows } = await db.query(`SELECT ${WINE_COLS}, w.image_url, ${NOTES_COLS} FROM wines w ${NOTES_JOIN} WHERE w.wine_id = ANY($1)`, [wineIds]);
  return new Map(rows.map((r) => {
    const features = wineFeatures(r as WineRow, notesOf(r));
    return [Number(r.wine_id), { row: r, features, style: recStyle(features) }];
  }));
}

/**
 * A priced wine with everything about it that doesn't depend on the user,
 * worked out once: features, style, and normalized text for searches.
 */
export interface Candidate {
  r: WineRow & { median_cents: number; n_merchants: number; image_url: string | null; image_checked_at: Date | null; descriptors?: unknown; food_pairings?: unknown; notes_text?: string | null };
  f: Features;
  style: RecStyle | '';
  /** Where it's from, normalized and padded, for region searches. */
  place: string;
  /** Researched descriptors and notes, normalized and padded, for tasting-note searches. */
  notes: string;
  /** Researched food pairings, as written and normalized. */
  pairings: { text: string; norm: string }[];
  /** Shops with it in stock lately. */
  merchants: number[];
}

/** Rebuilt when prices or researched notes change, and at least this often. */
const CANDIDATES_TTL_MS = 10 * 60_000;
const candidateCache = new WeakMap<Db, { key: string; at: number; list: Candidate[]; rebuilding: boolean }>();
const firstBuild = new WeakMap<Db, Promise<Candidate[]>>();

const CANDIDATES_KEY = `SELECT (SELECT count(*) || ':' || coalesce(max(computed_at)::text, '') FROM wine_prices)
     || '|' || (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM wine_info)
     || '|' || (SELECT coalesce(max(wine_id), 0) FROM wines) AS key`;

async function buildCandidates(db: Db): Promise<Candidate[]> {
  const { rows } = await db.query(
    `SELECT ${WINE_COLS}, w.image_url, w.image_checked_at, p.median_cents, p.n_merchants, ${NOTES_COLS}
       FROM wine_prices p JOIN wines w USING (wine_id)
       ${NOTES_JOIN}
      WHERE p.vintage_key = '*' AND p.currency = 'USD' AND NOT p.out_of_stock_only`
  );
  // Which shops have each wine in stock (seen in the last month).
  const { rows: stocked } = await db.query(
    `SELECT wine_id, array_agg(DISTINCT merchant_id) AS merchants FROM price_observations
      WHERE merchant_id IS NOT NULL AND in_stock IS NOT FALSE AND source_type <> 'user' AND observed_at > NOW() - INTERVAL '30 days'
      GROUP BY wine_id`
  );
  const shopsOf = new Map<number, number[]>(stocked.map((s) => [Number(s.wine_id), (s.merchants as unknown[]).map(Number)]));
  // Shops also sell spirits, beer and water; some of those ended up in the catalog.
  return rows.filter((r) => parseTitle(r.display_name).isWine).map((r): Candidate => {
    const f = wineFeatures(r as WineRow, notesOf(r));
    const pairings: string[] = Array.isArray(r.food_pairings) ? r.food_pairings.map(String) : [];
    return {
      r,
      f,
      style: recStyle(f),
      place: ` ${normalize(`${r.display_name} ${r.sub_region} ${r.region} ${r.country}`)} `,
      notes: ` ${normalize([...(Array.isArray(r.descriptors) ? r.descriptors.map(String) : []), r.notes_text ?? ''].join(' '))} `,
      pairings: pairings.map((text) => ({ text, norm: ` ${normalize(text)} ` })),
      merchants: shopsOf.get(Number(r.wine_id)) ?? [],
    };
  });
}

/**
 * Every in-stock priced wine (tens of thousands), worked out once and shared
 * by every request: scoring is then the only per-request work, which keeps
 * For you quick on a small server. When prices or notes change, the current
 * list keeps serving while the new one is built in the background; only the
 * very first request waits.
 */
export async function candidates(db: Db): Promise<Candidate[]> {
  const { rows: [k] } = await db.query(CANDIDATES_KEY);
  const hit = candidateCache.get(db);
  if (!hit) {
    // The first build (server start): everyone waits for the same one.
    let first = firstBuild.get(db);
    if (!first) {
      first = buildCandidates(db).then((list) => {
        candidateCache.set(db, { key: k.key, at: Date.now(), list, rebuilding: false });
        return list;
      }).finally(() => firstBuild.delete(db));
      firstBuild.set(db, first);
    }
    return first;
  }
  if ((hit.key !== k.key || Date.now() - hit.at > CANDIDATES_TTL_MS) && !hit.rebuilding) {
    hit.rebuilding = true;
    buildCandidates(db).then(
      (list) => candidateCache.set(db, { key: k.key, at: Date.now(), list, rebuilding: false }),
      () => { hit.rebuilding = false; }
    );
  }
  return hit.list;
}

/** Build the candidate list ahead of the first request (at server start). */
export async function warmRecommendations(db: Db): Promise<void> {
  await candidates(db);
}

/** Forget the candidate list, so the next request builds it from what's in the database now (tests). */
export function forgetRecommendationCandidates(db: Db): void {
  candidateCache.delete(db);
}

export type RecResult =
  /** styles: what the user has liked, for the app's filter (best-liked first). */
  | { mode: 'profile'; items: Recommendation[]; styles: RecStyle[]; summary: ProfileSummary; near?: NearResult }
  /** Not enough ratings to say anything personal yet: no suggestions, just how far along the user is. */
  | { mode: 'locked'; rated: number; needed: number; items: [] };

export async function recommend(db: Db, userId: number, opts: RecOptions = {}): Promise<RecResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const { profile, tasted, styles, unread } = await loadProfile(db, userId);
  if (unread.length) void opts.noteReader?.request(unread).catch(() => {});
  const search = Boolean(opts.styles?.length || opts.minPriceCents || opts.maxPriceCents || opts.region?.trim() || opts.notes?.trim() || opts.food?.trim());
  const regionWords = normalize(opts.region ?? '').split(' ').filter(Boolean);
  const wanted = wantedTaste(opts.notes);
  const foods = foodHints(opts.food);

  if (profile.n < MIN_RATED) return { mode: 'locked', rated: profile.n, needed: MIN_RATED, items: [] };

  const scored = (await candidates(db))
    .map((c) => {
      const { r, f, style } = c;
      if (tasted.has(r.wine_id)) return null;
      if (opts.maxPriceCents && r.median_cents > opts.maxPriceCents) return null;
      if (opts.minPriceCents && r.median_cents < opts.minPriceCents) return null;
      if (opts.colour && wineCategory(f) !== opts.colour) return null;
      if (opts.style && style !== opts.style) return null;
      if (opts.styles?.length && !opts.styles.includes(style as RecStyle)) return null;
      if (regionWords.length && !regionWords.every((w) => c.place.includes(` ${w} `))) return null;
      const s = scoreWine(profile, f, r.median_cents);
      // Best value: favour cheaper wines among good matches.
      let score = opts.bestValue ? s.score - 0.35 * Math.log(r.median_cents / 1000) : s.score;
      const extra: string[] = [];
      if (search) {
        // What was asked for counts more than the profile; the profile still breaks ties.
        const taste = tasteMatch(wanted, f, c.notes);
        const food = foodMatch(foods, f, style, c.pairings);
        score = 0.6 * score + taste.score + food.score;
        extra.push(...taste.reasons, ...food.reasons);
        if (regionWords.length) extra.push(`From ${titleCase(r.sub_region || r.region || opts.region!)}`);
      }
      const reasons = [...extra, ...explain(s.contributions)].slice(0, 2);
      return { r, style, score, rank: score + (r.image_url ? PHOTO_BONUS : 0), reasons, merchants: c.merchants };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.rank - a.rank || b.r.n_merchants - a.r.n_merchants);

  // Take turns between styles, so each shows up near the top: the styles searched for, else the ones the user liked.
  const turns = (sts: RecStyle[], needGood: boolean) => {
    const buckets = sts.map((st) => {
      const all = scored.filter((x) => x.style === st);
      const good = all.filter((x) => x.score > 0);
      return !needGood ? all : good.length ? good : all.slice(0, FALLBACK_PER_STYLE);
    });
    const out: typeof scored = [];
    for (let i = 0; buckets.some((b) => i < b.length); i++) for (const b of buckets) if (b[i]) out.push(b[i]!);
    return out;
  };
  let ordered: typeof scored;
  if (search) {
    ordered = opts.styles && opts.styles.length > 1 ? turns(opts.styles, false) : scored;
  } else if (opts.colour || opts.style) {
    // One style: its best matches, even when nothing in it matches the profile strongly.
    ordered = scored;
  } else if (styles.length) {
    ordered = turns(styles, true);
  } else {
    ordered = scored.filter((x) => x.score > 0);
  }

  // Near the person: only wines a shop close by has, or ships to them. If none do, everything, and say so.
  let near: NearResult | undefined;
  const bestReach = new Map<number, Reach>();
  if (opts.near && opts.places) {
    const shops = new Set(ordered.flatMap((x) => x.merchants));
    void opts.places.request(shops).catch(() => {});
    const { reach, pending } = await opts.places.reach(shops, opts.near);
    const closest = (a: Reach, b: Reach) => (a.local !== b.local ? (a.local ? a : b) : (a.miles ?? Infinity) <= (b.miles ?? Infinity) ? a : b);
    for (const x of ordered) {
      for (const m of x.merchants) {
        const r = reach.get(m);
        if (r) bestReach.set(x.r.wine_id, bestReach.has(x.r.wine_id) ? closest(bestReach.get(x.r.wine_id)!, r) : r);
      }
    }
    const reachable = ordered.filter((x) => bestReach.has(x.r.wine_id));
    near = { applied: reachable.length > 0, state: opts.near.state, pending };
    if (reachable.length) ordered = reachable;
  }

  const perProducer = new Map<string, number>();
  const picked: typeof ordered = [];
  for (const x of ordered) {
    const key = normalize(x.r.producer) || `#${x.r.wine_id}`;
    const n = perProducer.get(key) ?? 0;
    if (n >= PER_PRODUCER) continue;
    perProducer.set(key, n + 1);
    picked.push(x);
    if (picked.length >= limit) break;
  }
  // Photos as they are now (the candidate list can be a few minutes old, and photos are found in the background).
  const { rows: photos } = picked.length
    ? await db.query('SELECT wine_id, image_url, image_checked_at FROM wines WHERE wine_id = ANY($1)', [picked.map((x) => x.r.wine_id)])
    : { rows: [] };
  const photo = new Map(photos.map((p) => [Number(p.wine_id), p]));
  const items = picked.map((x) => {
    const now = photo.get(Number(x.r.wine_id)) ?? x.r;
    // No photo yet: look for one in the background, so it shows next time.
    if (!now.image_url) maybeQueueWineImage(db, { wine_id: x.r.wine_id, image_url: now.image_url, image_checked_at: now.image_checked_at });
    const rec = toRec({ ...x.r, image_url: now.image_url }, x.style, x.score, x.reasons);
    const r = near?.applied ? bestReach.get(x.r.wine_id) : undefined;
    if (r) rec.nearby = { shop: r.shop, local: r.local, miles: r.miles, city: r.city, ships: r.ships };
    return rec;
  });
  return { mode: 'profile', items, styles, summary: summarize(profile, styles), ...(near ? { near } : {}) };
}

function summarize(p: Profile, styles: RecStyle[]): ProfileSummary {
  const flavors = [...p.flavors.entries()].filter(([, s]) => s.weight > 0).sort((a, b) => b[1].weight - a[1].weight).slice(0, 4).map(([k]) => flavorLabel(k));
  const band = p.price ? [Math.exp(p.price.mu - p.price.sigma), Math.exp(p.price.mu + p.price.sigma)] : null;
  const round = (c: number) => Math.round(c / 500) * 500;
  return { rated: p.n, styles, priceLowCents: band ? round(band[0]!) : null, priceHighCents: band ? round(band[1]!) : null, flavors };
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Tasting notes asked for: flavor families, plus the words themselves to find in a wine's researched notes. */
function wantedTaste(notes?: string): { flavors: Flavor[]; words: string[] } {
  if (!notes?.trim()) return { flavors: [], words: [] };
  return { flavors: Object.keys(textFlavors(notes)) as Flavor[], words: normalize(notes).split(' ').filter((w) => w.length >= 4) };
}

/** `text`: the wine's researched descriptors and notes, normalized and padded with spaces. */
function tasteMatch(w: { flavors: Flavor[]; words: string[] }, f: Features, text: string) {
  if (!w.flavors.length && !w.words.length) return { score: 0, reasons: [] as string[] };
  const hits = w.flavors.filter((k) => (f.flavors?.[k] ?? 0) > 0);
  const words = w.words.filter((x) => text.includes(` ${x} `));
  const score = 0.6 * hits.length + 0.4 * words.length;
  const named = [...new Set([...hits.map((k) => flavorLabel(k)), ...words])].slice(0, 3);
  return { score, reasons: named.length ? [`Tastes of ${named.join(', ')}`] : [] };
}

/** Food and what goes with it, for wines whose researched pairings don't mention the dish. */
const FOOD_HINTS: { words: string[]; styles: RecStyle[]; flavors: Flavor[] }[] = [
  { words: ['steak', 'beef', 'lamb', 'burger', 'bbq', 'barbecue', 'brisket', 'venison', 'ribs'], styles: ['red'], flavors: ['tannic', 'full', 'black_fruit'] },
  { words: ['duck', 'mushroom', 'mushrooms', 'game', 'truffle'], styles: ['red'], flavors: ['earthy', 'red_fruit'] },
  { words: ['pork', 'chicken', 'turkey', 'veal'], styles: ['white', 'red', 'rose'], flavors: ['light', 'red_fruit', 'orchard'] },
  { words: ['fish', 'seafood', 'oyster', 'oysters', 'shellfish', 'sushi', 'scallops', 'crab', 'lobster', 'shrimp', 'prawns', 'clams', 'mussels'], styles: ['white', 'sparkling'], flavors: ['fresh', 'mineral', 'citrus'] },
  { words: ['salmon', 'tuna'], styles: ['rose', 'white', 'red'], flavors: ['light', 'red_fruit'] },
  { words: ['pasta', 'pizza', 'tomato', 'lasagna', 'bolognese'], styles: ['red'], flavors: ['red_fruit', 'fresh'] },
  { words: ['cheese', 'charcuterie'], styles: ['red', 'white', 'sweet'], flavors: ['savory', 'rich_sweet'] },
  { words: ['dessert', 'chocolate', 'cake', 'tart', 'pie', 'foie', 'blue'], styles: ['sweet'], flavors: ['sweet', 'rich_sweet'] },
  { words: ['spicy', 'curry', 'thai', 'indian', 'szechuan', 'chinese', 'mexican'], styles: ['white', 'rose'], flavors: ['stone_fruit', 'fresh', 'sweet'] },
  { words: ['salad', 'vegetables', 'veggies', 'asparagus', 'goat'], styles: ['white', 'rose'], flavors: ['herbal', 'fresh'] },
  { words: ['fried', 'chips', 'popcorn', 'caviar', 'tempura'], styles: ['sparkling'], flavors: ['fresh', 'yeasty'] },
];

function foodHints(food?: string): { words: string[]; hints: typeof FOOD_HINTS } {
  const words = normalize(food ?? '').split(' ').filter((w) => w.length >= 3);
  return { words, hints: FOOD_HINTS.filter((h) => h.words.some((x) => words.includes(x))) };
}

function foodMatch(q: ReturnType<typeof foodHints>, f: Features, style: RecStyle | '', pairings: Candidate['pairings']) {
  if (!q.words.length) return { score: 0, reasons: [] as string[] };
  const said = pairings.find((p) => q.words.some((w) => p.norm.includes(` ${w} `)))?.text;
  let score = said ? 1.2 : 0;
  for (const h of q.hints) {
    if (style && h.styles.includes(style)) score += 0.4;
    score += 0.25 * Math.min(2, h.flavors.filter((k) => (f.flavors?.[k] ?? 0) > 0).length);
  }
  return { score, reasons: said ? [`Pairs with ${said.toLowerCase()}`] : score > 0.6 ? [`Goes with ${q.words.slice(0, 2).join(' and ')}`] : [] };
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
