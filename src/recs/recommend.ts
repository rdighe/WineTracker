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
import { archetype, BUDGET_CENTS, loadPrefs, REACTION_RATING } from './archetypes.js';
import { recStyle, wineCategory, wineFeatures, type Features, type RecStyle, type WineNotes, type WineRow } from './features.js';
import { flavorLabel, mergeFlavors, textFlavors, type Flavor, type FlavorProfile } from './flavors.js';
import { buildProfile, explain, scoreWine, type Profile, type RatedWine } from './profile.js';
import { calibrationFor, fitOf, type Fit } from './fit.js';
import { predictEnjoyment } from './jevPredict.js';
import type { JevClient } from '../llm/jev.js';
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
  /** Jev, to check the first suggestions' fit against (src/recs/fit.ts). */
  jev?: JevClient | null;
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
  /** How likely they are to enjoy it (src/recs/fit.ts), checked by Jev where it runs. */
  fit: Fit;
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
  /** The wine in words ("Vietti Barolo Castiglione · Barolo, Italy · red nebbiolo"), for a model reading the palate. */
  label: string;
  /** The wine as anyone sees it: catalog fields and researched notes. */
  features: Features;
  style: RecStyle | '';
  /** Flavors in the person's own notes and tags by keyword, and as read by a model (null: not read yet, or nothing written). */
  own: { keywords: FlavorProfile; read: FlavorProfile | null; hasText: boolean };
}

/** A wine in words, for a model: name, place, colour or style and grape, and the flavors it shows. */
export function wineLabel(w: WineRow, f: Features): string {
  const flavors = Object.keys(f.flavors ?? {}).map(flavorLabel).slice(0, 6).join(', ');
  return [
    w.display_name,
    [w.sub_region || w.region, w.country].filter(Boolean).join(', '),
    [f.style && f.style !== 'still' ? f.style : f.colour, f.grape].filter(Boolean).join(' '),
    flavors && `tastes of ${flavors}`,
  ].filter(Boolean).join(' · ');
}

/** Which of the person's own flavors count: as read by a model (keywords until then), keywords only, or none. */
export type OwnFlavors = 'read' | 'keywords' | 'none';

/** Every rated tasting of the user, with what the profile needs. */
/**
 * Answers from the taste quiz count until the person has rated this many real
 * wines; past that, what they actually drank speaks for itself.
 */
export const SEEDS_UNTIL = 15;

/** The taste quiz's answers as rated wines: a typical wine of each kind (src/recs/archetypes.ts). */
export async function seededTastings(db: Db, userId: number): Promise<RatedTasting[]> {
  const { seeds } = await loadPrefs(db, userId);
  return Object.entries(seeds).flatMap(([key, reaction]) => {
    const a = archetype(key);
    const rating = reaction ? REACTION_RATING[reaction] : null;
    if (!a || rating === null) return [];
    const row = { wine_id: 0, ...a.row };
    const features = wineFeatures(row, { text: a.notes });
    return [{
      tastingId: 0, wineId: 0, rating, priceCents: null,
      label: `${wineLabel(row, features)} (a kind of wine they described, not one bottle)`,
      features, style: recStyle(features), own: { keywords: {}, read: null, hasText: false },
    }];
  });
}

export async function loadRatedTastings(db: Db, userId: number, opts: { seeds?: boolean } = {}): Promise<{ rated: RatedTasting[]; tasted: Set<number> }> {
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
      label: wineLabel(r as WineRow, features),
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
  // Too few real ratings yet: the taste quiz's answers fill in.
  if (opts.seeds !== false && rated.length < SEEDS_UNTIL) rated.push(...(await seededTastings(db, userId)));
  return { rated, tasted };
}

/** A rated tasting as a profile input, with the person's own flavors added to the wine's. */
export function ratedWine(t: RatedTasting, own: OwnFlavors = 'read'): RatedWine {
  const mine = own === 'none' ? {} : own === 'keywords' ? t.own.keywords : t.own.read ?? t.own.keywords;
  return { features: { ...t.features, flavors: mergeFlavors(t.features.flavors ?? {}, mine) }, rating: t.rating, priceCents: t.priceCents, ...(t.tastingId === 0 ? { said: true } : {}) };
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
export async function loadProfile(db: Db, userId: number): Promise<{
  profile: Profile; tasted: Set<number>; styles: RecStyle[]; unread: number[]; rated: RatedTasting[]; wines: RatedWine[];
}> {
  const [{ rated, tasted }, prefs] = await Promise.all([loadRatedTastings(db, userId), loadPrefs(db, userId)]);
  const wines = rated.map((t) => ratedWine(t));
  const profile = buildProfile(wines);
  // What they said they spend, until a few priced ratings say otherwise.
  if (prefs.budget && rated.filter((t) => t.priceCents).length < 3) profile.price = { mu: Math.log(BUDGET_CENTS[prefs.budget]), sigma: 0.45 };
  const liked = likedStyles(rated);
  return {
    profile,
    tasted,
    styles: liked.length ? liked : prefs.styles,
    unread: rated.filter((t) => t.own.hasText && !t.own.read).map((t) => t.tastingId),
    rated,
    wines,
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

/** Suggestions Jev is asked about (the first ones shown), and how long it gets before they go without. */
const JEV_CHECKED = 8;
const JEV_WAIT_MS = 6000;

/** Jev's enjoyment level (0..4) for each wine, by key; whatever it answers in time (cached answers are instant). */
async function jevCheck(db: Db, jev: JevClient, rated: RatedTasting[], wines: { key: string; label: string }[]): Promise<Map<string, number>> {
  if (!wines.length || !rated.length) return new Map();
  const timeout = new Promise<Map<string, { score: number }>>((resolve) => setTimeout(() => resolve(new Map()), JEV_WAIT_MS));
  const got = await Promise.race([predictEnjoyment(jev, rated, wines, db).catch(() => new Map<string, { score: number }>()), timeout]);
  return new Map([...got].map(([k, v]) => [k, v.score]));
}

export async function recommend(db: Db, userId: number, opts: RecOptions = {}): Promise<RecResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const { profile, tasted, styles, unread, rated, wines } = await loadProfile(db, userId);
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
      return { r, f, style, score, taste: s.score, rank: score + (r.image_url ? PHOTO_BONUS : 0), reasons, merchants: c.merchants };
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
  const cal = calibrationFor(userId, wines);
  const jev = opts.jev ? await jevCheck(db, opts.jev, rated, picked.slice(0, JEV_CHECKED).map((x) => ({ key: String(x.r.wine_id), label: wineLabel(x.r, x.f) }))) : new Map<string, number>();
  const items = picked.map((x) => {
    const now = photo.get(Number(x.r.wine_id)) ?? x.r;
    // No photo yet: look for one in the background, so it shows next time.
    if (!now.image_url) maybeQueueWineImage(db, { wine_id: x.r.wine_id, image_url: now.image_url, image_checked_at: now.image_checked_at });
    const rec = toRec({ ...x.r, image_url: now.image_url }, x.style, x.score, x.reasons, fitOf(cal, x.taste, jev.get(String(x.r.wine_id))));
    const r = near?.applied ? bestReach.get(x.r.wine_id) : undefined;
    if (r) rec.nearby = { shop: r.shop, local: r.local, miles: r.miles, city: r.city, ships: r.ships };
    return rec;
  });
  return { mode: 'profile', items, styles, summary: summarize(profile, styles), ...(near ? { near } : {}) };
}

/** A wine in the person's cellar, scored for an occasion (Home › Find a bottle). */
export interface CellarPick {
  wineId: number;
  displayName: string;
  region: string;
  style: RecStyle | '';
  imageUrl: string | null;
  /** The vintages held, newest first ("2019", "NV"). */
  vintages: string[];
  bottles: number;
  /** Where the bottles are, as the person wrote it (the newest entry's location). */
  location: string;
  /** Where one sits on a rack ("Kitchen rack · row 2, place 3"), when placed. */
  place: string | null;
  /** The cellar it's in, when the person has more than one. */
  cellar: string | null;
  /** Market price per 750 ml now, when known. */
  medianCents: number | null;
  myRating: number | null;
  score: number;
  reasons: string[];
  /** How well it suits their taste, apart from the occasion. */
  fit: Fit;
}

/**
 * The person's own bottles, best first for what they asked for: the same
 * food and tasting-note matching as a search, the taste profile, and their
 * own past rating of the wine. Unlike recommend() this needs no minimum of
 * ratings and includes wines they've tasted (they own them, after all).
 */
export async function cellarPicks(db: Db, userId: number, opts: { food?: string; notes?: string; styles?: RecStyle[]; limit?: number } = {}): Promise<{ items: CellarPick[] }> {
  const { rows } = await db.query(
    `SELECT ${WINE_COLS}, w.image_url, ${NOTES_COLS}, p.median_cents,
            sum(coalesce(t.bottles, 1))::int AS bottles,
            array_agg(DISTINCT coalesce(nullif(t.vintage_key, ''), 'NV')) AS vintages,
            (array_agg(t.location ORDER BY t.tasted_on DESC, t.tasting_id DESC))[1] AS location,
            (SELECT r.rating::float FROM tastings r WHERE r.user_id = $1 AND r.wine_id = w.wine_id AND r.rating IS NOT NULL
              ORDER BY r.tasted_on DESC, r.tasting_id DESC LIMIT 1) AS my_rating,
            (SELECT rk.name || ' · row ' || (s.row_no + 1) || ', place ' || (s.col_no + 1)
               FROM cellar_slots s JOIN cellar_racks rk USING (rack_id)
              WHERE s.tasting_id = ANY(array_agg(t.tasting_id)) ORDER BY rk.sort, s.row_no, s.col_no LIMIT 1) AS place,
            CASE WHEN (SELECT COUNT(*) FROM cellar_members cm WHERE cm.user_id = $1) > 1
                 THEN (SELECT c.name FROM cellars c WHERE c.cellar_id = min(t.cellar_id)) END AS cellar
       FROM tastings t JOIN wines w ON w.wine_id = t.wine_id
       ${NOTES_JOIN}
       LEFT JOIN wine_prices p ON p.wine_id = w.wine_id AND p.vintage_key = '*' AND p.currency = 'USD'
      WHERE t.kind = 'cellar'
        AND (t.cellar_id IN (SELECT cellar_id FROM cellar_members WHERE user_id = $1) OR (t.cellar_id IS NULL AND t.user_id = $1))
      GROUP BY ${WINE_COLS}, w.image_url, i.info, p.median_cents`,
    [userId]
  );
  if (!rows.length) return { items: [] };
  const { profile, wines } = await loadProfile(db, userId);
  const cal = calibrationFor(userId, wines);
  const wanted = wantedTaste(opts.notes);
  const foods = foodHints(opts.food);
  const items = rows.map((r): CellarPick | null => {
    const f = wineFeatures(r as WineRow, notesOf(r));
    const style = recStyle(f);
    if (opts.styles?.length && !opts.styles.includes(style as RecStyle)) return null;
    const pairings: string[] = Array.isArray(r.food_pairings) ? r.food_pairings.map(String) : [];
    const notes = ` ${normalize([...(Array.isArray(r.descriptors) ? r.descriptors.map(String) : []), r.notes_text ?? ''].join(' '))} `;
    const s = scoreWine(profile, f, r.median_cents ?? null);
    const taste = tasteMatch(wanted, f, notes);
    const food = foodMatch(foods, f, style, pairings.map((text) => ({ text, norm: ` ${normalize(text)} ` })));
    const myRating = r.my_rating == null ? null : Number(r.my_rating);
    // Their own verdict on this very wine counts most: a 4.5 they loved beats a profile guess.
    const own = myRating == null ? 0 : 0.5 * (myRating - 3);
    const score = 0.6 * s.score + taste.score + food.score + own;
    const reasons = [...food.reasons, ...taste.reasons, ...(myRating != null && myRating >= 4 ? [`You rated it ${myRating}`] : []), ...explain(s.contributions)].slice(0, 3);
    const vintages = (r.vintages as string[]).filter(Boolean).sort((a, b) => (a === 'NV' ? 1 : b === 'NV' ? -1 : b.localeCompare(a)));
    return {
      wineId: Number(r.wine_id), displayName: r.display_name, region: r.sub_region || r.region, style, imageUrl: r.image_url ?? null,
      vintages, bottles: Number(r.bottles), location: r.location ?? '', place: r.place ?? null, cellar: r.cellar ?? null, medianCents: r.median_cents ?? null, myRating,
      score: Math.round(score * 1000) / 1000, reasons, fit: fitOf(cal, s.score),
    };
  }).filter((x): x is CellarPick => x !== null && x.bottles > 0);
  items.sort((a, b) => b.score - a.score);
  return { items: items.slice(0, Math.min(opts.limit ?? 10, 50)) };
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

function foodHints(food?: string): { words: string[]; hints: typeof FOOD_HINTS; dish: string } {
  const words = normalize(food ?? '').split(' ').filter((w) => w.length >= 3);
  // The dish as typed, for the reason ("Goes with lamb chops"), kept short.
  const typed = (food ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const dish = typed.length > 40 ? `${typed.slice(0, 39).replace(/\s\S*$/, '')}…` : typed;
  return { words, hints: FOOD_HINTS.filter((h) => h.words.some((x) => words.includes(x))), dish };
}

function foodMatch(q: ReturnType<typeof foodHints>, f: Features, style: RecStyle | '', pairings: Candidate['pairings']) {
  if (!q.words.length) return { score: 0, reasons: [] as string[] };
  const said = pairings.find((p) => q.words.some((w) => p.norm.includes(` ${w} `)))?.text;
  let score = said ? 1.2 : 0;
  for (const h of q.hints) {
    if (style && h.styles.includes(style)) score += 0.4;
    score += 0.25 * Math.min(2, h.flavors.filter((k) => (f.flavors?.[k] ?? 0) > 0).length);
  }
  return { score, reasons: said ? [`Pairs with ${said.toLowerCase()}`] : score > 0.6 ? [`Goes with ${q.dish}`] : [] };
}

function toRec(r: WineRow & { median_cents: number; n_merchants: number; image_url?: string | null }, style: RecStyle | '', score: number, reasons: string[], fit: Fit): Recommendation {
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
    fit,
  };
}
