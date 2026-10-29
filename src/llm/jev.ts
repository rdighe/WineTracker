/**
 * Jev (TypeSafe AI's "System One" decision model) through OpenRouter: it
 * writes no text, it answers typed questions about a block of text (the
 * state) with calibrated probabilities, in one fast call.
 *
 *   choice  pick one of named options          -> { choice, probabilities, confidence }
 *   score   place on an ordered scale (1-10)   -> { score (0..levels-1, fractional), probabilities, confidence }
 *   noul    a yes/no statement                 -> { noul: probability of yes }
 *
 * A prototype, switched on per use with JEV_FEATURES (match, flavors,
 * predict; src/config.ts). API: POST https://openrouter.ai/api/v1/systemone
 * with the OpenRouter key; see docs.typesafe.ai/api.
 */
import { FLAVORS } from '../recs/flavors.js';
import { MAX_NOTE_CHARS } from './prompts.js';
import { ProviderUnavailableError, type LlmProvider, type NoteFlavors } from './types.js';

type FetchFn = typeof fetch;

export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

export type JevAnswer =
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> }
  | { type: 'noul'; noul: number };

export interface JevOptions {
  apiKey: string;
  /** Pinned, so answers don't shift under us; JEV_MODEL overrides. */
  model?: string;
  baseUrl?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';

export class JevError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Jev HTTP ${status}${detail ? `: ${detail}` : ''}`);
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const probs = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, p]) => num(p) !== null)) as Record<string, number> : {};

export class JevClient {
  readonly name = 'jev';
  private readonly fetchImpl: FetchFn;

  constructor(private readonly opts: JevOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Ask the questions about `state`; answers by question name (a question with no usable answer is left out). */
  async ask(state: string, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
    const resp = await this.fetchImpl(`${this.opts.baseUrl ?? 'https://openrouter.ai/api'}/v1/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}`, 'X-Title': 'WineTracker' },
      body: JSON.stringify({ model: this.opts.model ?? DEFAULT_JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000),
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => null)) as { error?: { message?: string } | string } | null;
      const msg = typeof err?.error === 'string' ? err.error : err?.error?.message ?? '';
      throw new JevError(resp.status, String(msg).slice(0, 200));
    }
    const data = (await resp.json()) as { answers?: Record<string, Record<string, unknown>> };
    const out: Record<string, JevAnswer> = {};
    for (const [name, q] of Object.entries(questions)) {
      const a = data.answers?.[name];
      if (!a) continue;
      if (q.type === 'choice' && typeof a.choice === 'string') {
        out[name] = { type: 'choice', choice: a.choice, confidence: num(a.confidence) ?? 0, probabilities: probs(a.probabilities) };
      } else if (q.type === 'score' && num(a.score) !== null) {
        out[name] = { type: 'score', score: num(a.score)!, confidence: num(a.confidence) ?? 0, probabilities: probs(a.probabilities) };
      } else if (q.type === 'noul' && num(a.noul) !== null) {
        out[name] = { type: 'noul', noul: num(a.noul)! };
      }
    }
    return out;
  }
}

/**
 * Flavors in a drinker's own note, as Jev scores them: one question per
 * flavor family, from "not there" to "dominant", in one call. Used as an
 * LlmProvider by the note reader (src/tastings/noteFlavors.ts).
 */
export function jevNoteReader(jev: JevClient): LlmProvider {
  return {
    name: 'jev',
    readLabel: () => Promise.reject(new ProviderUnavailableError('Jev reads no images')),
    searchPrices: () => Promise.reject(new ProviderUnavailableError('Jev does no web search')),
    async readNoteFlavors(text: string): Promise<NoteFlavors> {
      const questions = Object.fromEntries(Object.entries(FLAVORS).map(([key, f]) => [key, {
        type: 'score' as const,
        instructions: `How strongly does the drinker say the wine shows ${f.label} (${f.words.slice(0, 5).join(', ')})? Only what the note says; something the note says is absent counts as not there.`,
        criteria: ['Not there, or not mentioned', 'A hint', 'Clearly there', 'Dominant'],
      }]));
      const answers = await jev.ask(`A wine drinker's own tasting note:\n${text.slice(0, MAX_NOTE_CHARS)}`, questions);
      const out: NoteFlavors = {};
      for (const [key, a] of Object.entries(answers)) {
        if (a.type !== 'score') continue;
        const level = Math.round(a.score);
        if (level >= 1) out[key] = Math.min(level, 3) as 1 | 2 | 3;
      }
      return out;
    },
  };
}
