/**
 * Jev's prediction of how much a person will enjoy a wine (a prototype; see
 * src/llm/jev.ts): the state is what they've rated, in words; each wine is
 * a score question from "would dislike it" to "would love it". Blended into
 * the taste-profile score for wine lists and shelves, and measured against
 * it by scripts/eval-recs.ts --jev before it is relied on.
 */
import type { Db } from '../db/pool.js';
import { jevCached, jevKeep, jevKey, type JevClient } from '../llm/jev.js';
import type { RatedTasting } from './recommend.js';

export const ENJOY_LEVELS = ['Would dislike it', 'Not their kind of wine', 'Might enjoy it', 'Would enjoy it', 'Would love it'];
/** The middle of the scale: what a prediction is centred on when blended. */
export const ENJOY_MID = (ENJOY_LEVELS.length - 1) / 2;
/** Ratings in the state: the most telling ones (furthest from the person's average), at most this many. */
const MAX_RATED = 60;
/** Wines asked about per call, and calls at once. */
const PER_CALL = 40;
const CALLS_AT_ONCE = 3;

/** What the person has rated, in words, the most telling first. */
export function palateState(rated: RatedTasting[]): string {
  const mean = rated.reduce((s, r) => s + r.rating, 0) / Math.max(1, rated.length);
  const telling = [...rated].sort((a, b) => Math.abs(b.rating - mean) - Math.abs(a.rating - mean)).slice(0, MAX_RATED);
  const own = (r: RatedTasting) => Object.keys(r.own.read ?? r.own.keywords).join(', ');
  return [
    `Wines this person has rated, from 1 (disliked) to 5 (loved); their average is ${mean.toFixed(1)}:`,
    ...telling.map((r) => `- ${r.label}: ${r.rating}${own(r) ? ` (they noted: ${own(r)})` : ''}`),
  ].join('\n');
}

/**
 * How much the person will enjoy each wine (0 dislike .. 4 love, fractional),
 * by key. A wine Jev didn't answer for is left out.
 */
export async function predictEnjoyment(
  jev: JevClient, rated: RatedTasting[], wines: { key: string; label: string }[], db?: Db
): Promise<Map<string, { score: number; confidence: number }>> {
  const state = palateState(rated);
  const out = new Map<string, { score: number; confidence: number }>();
  // Predicted before for these same ratings (a list reopened, a page added): kept, not asked again.
  const cacheKey = (label: string) => jevKey('predict', state, label);
  const kept = db ? await jevCached<{ score: number; confidence: number }>(db, wines.map((w) => cacheKey(w.label))) : new Map();
  const fresh: [string, { score: number; confidence: number }][] = [];
  for (const w of wines) {
    const k = kept.get(cacheKey(w.label));
    if (k) out.set(w.key, k);
  }
  const todo = wines.filter((w) => !out.has(w.key));
  const batches: { key: string; label: string }[][] = [];
  for (let i = 0; i < todo.length; i += PER_CALL) batches.push(todo.slice(i, i + PER_CALL));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CALLS_AT_ONCE, batches.length) }, async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      const questions = Object.fromEntries(batch.map((w, i) => [`w${i}`, {
        type: 'score' as const,
        instructions: `How much will this person enjoy this wine: ${w.label}?`,
        criteria: ENJOY_LEVELS,
      }]));
      const answers = await jev.ask(state, questions, 'predict');
      batch.forEach((w, i) => {
        const a = answers[`w${i}`];
        if (a?.type !== 'score') return;
        const p = { score: a.score, confidence: a.confidence };
        out.set(w.key, p);
        fresh.push([cacheKey(w.label), p]);
      });
    }
  }));
  if (db) await jevKeep(db, fresh);
  return out;
}
