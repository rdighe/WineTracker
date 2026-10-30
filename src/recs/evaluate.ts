/**
 * How well the taste profile predicts a person's own ratings, by leaving
 * one wine out at a time: build the profile from every other rated wine,
 * score the held-out one as For you would (catalog features only - its
 * notes aren't known before tasting it), and compare scores with ratings.
 *
 *   concordance  of two wines rated differently, how often the better-rated
 *                one scores higher (0.5 = a coin flip, 1 = always)
 *   spearman     rank correlation of scores and ratings (0 = none, 1 = same order)
 *   liked        wines rated LIKED or more; where each would rank among the
 *                priced catalog: the median percentile from the top, and the
 *                share that would make the top 5% and 10%
 *   fit          the fit percentage the app shows (src/recs/fit.ts), calibrated
 *                without the held-out wine: Brier score, and how often wines in
 *                each band were enjoyed; with Jev, how often the fit was right
 *                when Jev agreed with it and when it didn't
 *
 * Run it with scripts/eval-recs.ts.
 */
import type { Features } from './features.js';
import { buildProfile, scoreWine } from './profile.js';
import { ratedWine, type OwnFlavors, type RatedTasting } from './recommend.js';
import { ENJOY_MID } from './jevPredict.js';
import { calibrate, enjoyed, fitOf, jevAgrees, type FitBand } from './fit.js';

export const LIKED = 4;

export interface CatalogWine {
  wineId: number;
  features: Features;
  priceCents: number | null;
}

export interface EvalResult {
  tastings: number;
  wines: number;
  /** Pairs of tastings rated differently. */
  pairs: number;
  concordance: number | null;
  spearman: number | null;
  /** Wines rated LIKED or more. */
  liked: number;
  /** Median share of the catalog scoring above a liked wine (lower is better); null without a catalog. */
  likedMedianPct: number | null;
  likedTop5: number | null;
  likedTop10: number | null;
}

/** Ranks from 1, ties sharing their average rank. */
function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

/** Of pairs with different ratings, the share scored in the same order (ties in score count half). */
export function concordance(scores: number[], ratings: number[]): { value: number | null; pairs: number } {
  let agree = 0, pairs = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      if (ratings[i] === ratings[j]) continue;
      pairs++;
      const d = (scores[i]! - scores[j]!) * (ratings[i]! - ratings[j]!);
      agree += d > 0 ? 1 : d === 0 ? 0.5 : 0;
    }
  }
  return { value: pairs ? agree / pairs : null, pairs };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function evaluateUser(rated: RatedTasting[], own: OwnFlavors, catalog: CatalogWine[] = []): EvalResult {
  const tasted = new Set(rated.map((t) => t.wineId));
  const others = catalog.filter((c) => !tasted.has(c.wineId));
  const scores: number[] = [];
  const ratings: number[] = [];
  const likedPct: number[] = [];
  // Leave out every tasting of a wine at once, so a second bottle of it doesn't give the answer away.
  for (const wineId of tasted) {
    const held = rated.filter((t) => t.wineId === wineId);
    const profile = buildProfile(rated.filter((t) => t.wineId !== wineId).map((t) => ratedWine(t, own)));
    const score = scoreWine(profile, held[0]!.features, held[0]!.priceCents).score;
    for (const t of held) {
      scores.push(score);
      ratings.push(t.rating);
    }
    if (others.length && held.some((t) => t.rating >= LIKED)) {
      const above = others.filter((c) => scoreWine(profile, c.features, c.priceCents).score > score).length;
      likedPct.push(above / others.length);
    }
  }
  const c = concordance(scores, ratings);
  return {
    tastings: rated.length,
    wines: tasted.size,
    pairs: c.pairs,
    concordance: c.value,
    spearman: spearman(scores, ratings),
    liked: new Set(rated.filter((t) => t.rating >= LIKED).map((t) => t.wineId)).size,
    likedMedianPct: likedPct.length ? median(likedPct) : null,
    likedTop5: likedPct.length ? likedPct.filter((p) => p < 0.05).length / likedPct.length : null,
    likedTop10: likedPct.length ? likedPct.filter((p) => p < 0.1).length / likedPct.length : null,
  };
}

/**
 * Jev's predictions (src/recs/jevPredict.ts) held to the same test: each
 * rated wine left out in turn, predicted from the rest. One call per wine.
 * Returns the order measures for Jev alone and blended into the profile score
 * as wine lists blend it, beside the profile score's own.
 */
export async function evaluateJev(
  rated: RatedTasting[], predict: (others: RatedTasting[], wine: RatedTasting) => Promise<number | null>, own: OwnFlavors = 'read', weight = 1, concurrency = 4
): Promise<{ wines: number; answered: number; byWine: Map<number, number>; profile: Pick<EvalResult, 'concordance' | 'spearman'>; jev: Pick<EvalResult, 'concordance' | 'spearman'>; blended: Pick<EvalResult, 'concordance' | 'spearman'> }> {
  const wineIds = [...new Set(rated.map((t) => t.wineId))];
  const rows: { profile: number; jev: number | null; ratings: number[] }[] = new Array(wineIds.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, wineIds.length) }, async () => {
    while (next < wineIds.length) {
      const i = next++;
      const wineId = wineIds[i]!;
      const held = rated.filter((t) => t.wineId === wineId);
      const others = rated.filter((t) => t.wineId !== wineId);
      const profile = scoreWine(buildProfile(others.map((t) => ratedWine(t, own))), held[0]!.features, held[0]!.priceCents).score;
      rows[i] = { profile, jev: await predict(others, held[0]!).catch(() => null), ratings: held.map((t) => t.rating) };
    }
  }));
  const answered = rows.filter((r) => r.jev !== null);
  const measure = (pick: (r: (typeof rows)[number]) => number) => {
    const scores = answered.flatMap((r) => r.ratings.map(() => pick(r)));
    const ratings = answered.flatMap((r) => r.ratings);
    return { concordance: concordance(scores, ratings).value, spearman: spearman(scores, ratings) };
  };
  return {
    wines: wineIds.length,
    answered: answered.length,
    byWine: new Map(rows.flatMap((r, i) => (r.jev === null ? [] : [[wineIds[i]!, r.jev] as [number, number]]))),
    // On the same wines Jev answered, so the three are comparable.
    profile: measure((r) => r.profile),
    jev: measure((r) => r.jev!),
    blended: measure((r) => r.profile + weight * (r.jev! - ENJOY_MID)),
  };
}

export interface FitEval {
  wines: number;
  /** Mean squared error of the fit (as a share) against enjoyed or not: 0.25 is a coin flip, lower is better. */
  brier: number | null;
  /** Per band: wines shown in it, and how many of those they enjoyed. */
  bands: Record<FitBand, { n: number; enjoyed: number }>;
  /** With Jev's predictions: was the fit right (50%+ and enjoyed, or under and not) when Jev agreed, and when it didn't. */
  jev?: { agrees: { n: number; right: number }; unsure: { n: number; right: number } };
}

/**
 * The fit the app would have shown for each rated wine, from everything else
 * they rated (profile and calibration both), against whether they enjoyed
 * it. At most `max` wines are held out (each costs a calibration).
 */
export function evaluateFit(rated: RatedTasting[], jevByWine?: Map<number, number>, own: OwnFlavors = 'read', max = 60): FitEval {
  const mean = rated.reduce((s, t) => s + t.rating, 0) / Math.max(1, rated.length);
  const bands: FitEval['bands'] = { strong: { n: 0, enjoyed: 0 }, good: { n: 0, enjoyed: 0 }, maybe: { n: 0, enjoyed: 0 }, unlikely: { n: 0, enjoyed: 0 } };
  const jev = { agrees: { n: 0, right: 0 }, unsure: { n: 0, right: 0 } };
  let sq = 0, n = 0;
  for (const held of rated.slice(-max)) {
    const others = rated.filter((t) => t !== held).map((t) => ratedWine(t, own));
    const score = scoreWine(buildProfile(others), held.features, held.priceCents).score;
    const cal = calibrate(others);
    const fit = fitOf(cal, score, jevByWine?.get(held.wineId));
    const p = 1 / (1 + Math.exp(-(cal.a * score + cal.b)));
    const y = enjoyed(held.rating, mean);
    sq += (p - (y ? 1 : 0)) ** 2;
    n++;
    bands[fit.band].n++;
    if (y) bands[fit.band].enjoyed++;
    const agrees = jevAgrees(p, jevByWine?.get(held.wineId));
    if (agrees !== null) {
      const k = agrees ? 'agrees' : 'unsure';
      jev[k].n++;
      if ((p >= 0.5) === y) jev[k].right++;
    }
  }
  return { wines: n, brier: n ? sq / n : null, bands, ...(jevByWine ? { jev } : {}) };
}
