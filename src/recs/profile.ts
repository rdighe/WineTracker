/**
 * Content-based taste profile.
 *
 * Each rated tasting votes for its wine's features with (rating - the user's
 * mean rating): wines liked more than usual pull their grape/appellation/
 * producer up, disliked ones push them down. Votes are shrunk toward zero for
 * features seen only once, so one great bottle doesn't dominate.
 *
 * Price: the user's comfortable range is the log-price spread of wines they
 * rated at or above their mean (market price, else what they paid).
 */
import { FEATURE_KINDS, type FeatureKind, type Features } from './features.js';

export const KIND_WEIGHT: Record<FeatureKind, number> = {
  grape: 1.0, appellation: 1.0, region: 0.7, producer: 0.8, country: 0.4, colour: 0.6, style: 0.6,
};
const SHRINK = 1; // pseudo-count pulling single observations toward 0

export interface RatedWine {
  features: Features;
  rating: number;
  priceCents: number | null; // market (or paid) per-750 price
}

export interface FeatureStat {
  weight: number;  // shrunk mean centered rating
  liked: number;   // tastings rated above the user's mean
  count: number;
}

export interface Profile {
  meanRating: number;
  n: number;
  features: Record<FeatureKind, Map<string, FeatureStat>>;
  price: { mu: number; sigma: number } | null; // log(cents)
}

export function buildProfile(rated: RatedWine[]): Profile {
  const n = rated.length;
  const meanRating = n ? rated.reduce((a, r) => a + r.rating, 0) / n : 3.5;
  const features = Object.fromEntries(FEATURE_KINDS.map((k) => [k, new Map<string, FeatureStat>()])) as Profile['features'];
  const sums = Object.fromEntries(FEATURE_KINDS.map((k) => [k, new Map<string, { s: number; c: number; liked: number }>()])) as Record<
    FeatureKind,
    Map<string, { s: number; c: number; liked: number }>
  >;
  for (const r of rated) {
    // A small bonus for every tasting: choosing a wine is itself a signal.
    const v = r.rating - meanRating + 0.15;
    for (const k of FEATURE_KINDS) {
      const val = r.features[k];
      if (!val) continue;
      const cur = sums[k].get(val) ?? { s: 0, c: 0, liked: 0 };
      cur.s += v;
      cur.c += 1;
      if (r.rating >= meanRating && r.rating >= 3.5) cur.liked += 1;
      sums[k].set(val, cur);
    }
  }
  for (const k of FEATURE_KINDS) {
    for (const [val, { s, c, liked }] of sums[k]) features[k].set(val, { weight: s / (c + SHRINK), liked, count: c });
  }
  const logs = rated.filter((r) => r.priceCents && r.rating >= meanRating).map((r) => Math.log(r.priceCents!));
  let price: Profile['price'] = null;
  if (logs.length) {
    const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mu) ** 2, 0) / logs.length);
    price = { mu, sigma: Math.max(sd, 0.35) }; // at least ~±40% comfort band
  }
  return { meanRating, n, features, price };
}

export interface Contribution {
  kind: FeatureKind | 'price';
  value: string;
  amount: number;
  liked: number;
}

export interface WineScore {
  score: number;
  contributions: Contribution[];
}

export function scoreWine(p: Profile, f: Features, priceCents: number | null): WineScore {
  const contributions: Contribution[] = [];
  let score = 0;
  for (const k of FEATURE_KINDS) {
    const val = f[k];
    const stat = val ? p.features[k].get(val) : undefined;
    if (!val || !stat) continue;
    const amount = stat.weight * KIND_WEIGHT[k];
    score += amount;
    contributions.push({ kind: k, value: val, amount, liked: stat.liked });
  }
  if (p.price && priceCents) {
    const z = (Math.log(priceCents) - p.price.mu) / p.price.sigma;
    // Free inside the comfort band, then an increasing penalty (pricier hurts more than cheaper).
    const over = Math.max(0, Math.abs(z) - 1);
    const amount = -0.25 * over * over * (z > 0 ? 1.5 : 1);
    if (amount) contributions.push({ kind: 'price', value: z > 0 ? 'above your usual range' : 'below your usual range', amount, liked: 0 });
    score += amount;
  }
  contributions.sort((a, b) => b.amount - a.amount);
  return { score, contributions };
}

const LABEL: Record<FeatureKind, string> = {
  grape: '', appellation: '', region: '', country: 'wines from ', producer: '', colour: '', style: '',
};

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** One-line reasons from the strongest positive contributions. */
export function explain(contributions: Contribution[]): string[] {
  return contributions
    .filter((c) => c.amount > 0.05 && c.kind !== 'price' && c.liked > 0 && c.kind !== 'colour' && c.kind !== 'style')
    .slice(0, 2)
    .map((c) => `You rated ${c.liked} ${LABEL[c.kind as FeatureKind]}${title(c.value)} ${c.liked === 1 ? 'wine' : 'wines'} highly`);
}
