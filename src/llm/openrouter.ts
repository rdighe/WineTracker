/**
 * OpenRouter provider: label reading on OpenRouter's free vision models
 * (model ids ending in ":free"), through its OpenAI-compatible chat API.
 *
 * Free models are rate limited per model (and per account per day), so a
 * busy or rate-limited model hands over to the next one instead of failing -
 * unlike Gemini, where every model shares one billed quota.
 *
 * Price search is not offered: OpenRouter's web search is a paid add-on, so
 * price refreshes re-check known shop pages only.
 */
import { extractJson } from './json.js';
import { LABEL_PROMPT } from './prompts.js';
import { sanitizeLabel } from './sanitize.js';
import { ProviderUnavailableError, type LabelRead, type LlmProvider } from './types.js';

type FetchFn = typeof fetch;

export interface OpenRouterOptions {
  apiKey: string;
  /** Tried first; OPENROUTER_MODEL. */
  model?: string;
  baseUrl?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

// Free models that take images, best label readers first; "openrouter/free" lets OpenRouter pick any free vision model.
export const DEFAULT_FREE_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-26b-a4b-it:free',
  'openrouter/free',
];

class OpenRouterHttpError extends Error {
  constructor(readonly model: string, readonly status: number, detail: string) {
    super(`OpenRouter ${model} HTTP ${status}${detail ? `: ${detail}` : ''}`);
  }
}

export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';
  private readonly models: string[];
  private working: string | null = null;
  private readonly fetchImpl: FetchFn;

  constructor(private readonly opts: OpenRouterOptions) {
    this.models = [...new Set([opts.model, ...DEFAULT_FREE_MODELS].filter((m): m is string => Boolean(m)))];
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async chat(model: string, content: unknown[]): Promise<string> {
    const resp = await this.fetchImpl(`${this.opts.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
        'X-Title': 'WineTracker',
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60000),
    });
    if (!resp.ok) {
      // OpenRouter explains refusals (e.g. a privacy setting that rules out free endpoints) in error.message.
      const err = (await resp.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new OpenRouterHttpError(model, resp.status, String(err?.error?.message ?? '').slice(0, 200));
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string | null } }>; error?: { message?: string } };
    if (data.error) throw new OpenRouterHttpError(model, 502, String(data.error.message ?? '').slice(0, 200));
    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Try models in order (last working first) until one gives a usable reply.
   * Free calls cost nothing, so any HTTP failure or unusable reply moves on
   * to the next model - except a bad key (401) or no credits/permission
   * (402/403), which every model would repeat.
   */
  private async firstGood<T>(run: (model: string) => Promise<string>, parse: (text: string) => T | null): Promise<T> {
    const order = [...new Set([this.working, ...this.models].filter((m): m is string => Boolean(m)))];
    let lastErr: unknown = new Error('no usable reply');
    for (const model of order) {
      try {
        const out = parse(await run(model));
        if (out !== null) {
          this.working = model;
          return out;
        }
      } catch (err) {
        lastErr = err;
        if (err instanceof OpenRouterHttpError && [401, 402, 403].includes(err.status)) throw err;
      }
      if (this.working === model) this.working = null;
    }
    throw lastErr;
  }

  readLabel(image: Buffer, mimeType: string): Promise<LabelRead> {
    const content = [
      { type: 'text', text: LABEL_PROMPT },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
    ];
    return this.firstGood(
      (m) => this.chat(m, content),
      (text) => sanitizeLabel(extractJson(text, 'object'))
    );
  }

  async searchPrices(): Promise<never> {
    throw new ProviderUnavailableError('OpenRouter free models have no web search; prices come from shop pages');
  }
}
