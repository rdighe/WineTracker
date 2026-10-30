/**
 * Fit: how likely the person is to enjoy a wine, as a percentage rounded
 * to 5 with a plain-words band, instead of a predicted star rating (which
 * reads as more precise than any palate model is).
 *
 * The taste profile's score (src/recs/profile.ts) is relative, so it's
 * calibrated per person against their own ratings: each rated wine is scored
 * by a profile built from all their other ratings (leave one out), and a
 * logistic curve is fitted from that score to "they enjoyed it" (rated at or
 * above their usual, 3.5 to 4). With few ratings the curve stays near a
 * cautious prior; under MIN_FOR_PERCENT ratings only the band is given.
 *
 * Jev (src/recs/jevPredict.ts), where it runs, is an independent check: its
 * enjoyment level is compared with the match, and the app says whether it
 * agrees. Agreement is what a match is worth leaning on; disagreement is
 * shown, not hidden.
 */
import { buildProfile, scoreWine, type RatedWine } from './profile.js';

export interface Calibration { a: number; b: number; n: number }
export type FitBand = 'strong' | 'good' | 'maybe' | 'unlikely';
export interface Fit {
  /** 5..95 in steps of 5; null with too few ratings to put a number on it. */
  percent: number | null;
  band: FitBand;
  /** Ratings (and taste-quiz answers) it rests on. */
  basis: number;
  /** Jev's independent read, when it was asked: agrees (within JEV_AGREE) or not. */
  jev?: 'agrees' | 'unsure';
}

export const MIN_FOR_PERCENT = 6;
/** Jev agrees when its enjoyment (0..4, as a share) is this close to the match. */
export const JEV_AGREE = 0.3;
/** Ratings used to calibrate: the most recent ones; enough to fit two numbers. */
const MAX_CALIBRATION = 120;
/** Before any evidence: a higher score is likelier enjoyed, at about this slope. */
const PRIOR_SLOPE = 2;
/** How many ratings' worth the prior counts for. */
const PRIOR_WEIGHT = 2;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** Whether a rating counts as enjoyed, for this person. */
export function enjoyed(rating: number, mean: number): boolean {
  return rating >= Math.min(4, Math.max(3.5, mean));
}

/** Fit the score -> enjoyed curve to the person's own ratings, each scored without itself. */
export function calibrate(wines: RatedWine[]): Calibration {
  const rated = wines.slice(-MAX_CALIBRATION);
  const n = rated.length;
  const mean = n ? rated.reduce((s, r) => s + r.rating, 0) / n : 3.5;
  const ys = rated.map((r) => (enjoyed(r.rating, mean) ? 1 : 0));
  const base = (ys.reduce<number>((s, y) => s + y, 0) + 1) / (n + 2);
  const prior = { a: PRIOR_SLOPE, b: logit(base) };
  if (n < 2) return { ...prior, n };
  const xs = rated.map((r, i) => scoreWine(buildProfile(rated.filter((_, j) => j !== i)), r.features, r.priceCents).score);
  // Newton's method on the log-likelihood, with the prior as a penalty pulling toward it.
  let { a, b } = prior;
  for (let it = 0; it < 30; it++) {
    let ga = PRIOR_WEIGHT * (a - prior.a), gb = PRIOR_WEIGHT * (b - prior.b);
    let haa = PRIOR_WEIGHT, hab = 0, hbb = PRIOR_WEIGHT;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * xs[i]! + b);
      const w = p * (1 - p);
      ga += (p - ys[i]!) * xs[i]!;
      gb += p - ys[i]!;
      haa += w * xs[i]! * xs[i]!;
      hab += w * xs[i]!;
      hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-9) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-6) break;
  }
  // A higher profile score never makes a wine less likely to please.
  return { a: Math.max(0.3, a), b, n };
}

export const bandOf = (p: number): FitBand => (p >= 0.75 ? 'strong' : p >= 0.55 ? 'good' : p >= 0.35 ? 'maybe' : 'unlikely');

/** The match for a wine with this taste-profile score; jevScore 0..4 when Jev was asked. */
export function fitOf(cal: Calibration, score: number, jevScore?: number | null): Fit {
  const p = sigmoid(cal.a * score + cal.b);
  const m: Fit = {
    percent: cal.n >= MIN_FOR_PERCENT ? Math.min(95, Math.max(5, Math.round((p * 100) / 5) * 5)) : null,
    band: bandOf(p),
    basis: cal.n,
  };
  if (jevScore != null) m.jev = Math.abs(jevScore / 4 - p) <= JEV_AGREE ? 'agrees' : 'unsure';
  return m;
}

/** Calibrations by person and what they've rated, so a list of picks doesn't refit it. */
const cache = new Map<string, Calibration>();
export function calibrationFor(userId: number, wines: RatedWine[]): Calibration {
  const key = `${userId}:${wines.length}:${wines.reduce((s, r, i) => s + r.rating * (i + 1), 0)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cal = calibrate(wines);
  if (cache.size > 500) cache.clear();
  cache.set(key, cal);
  return cal;
}
