/**
 * Gemini provider (Google AI Studio API).
 *
 * Same approach as Wine Circle's wineResearch.js: Google renames and retires
 * models, so try a ranked list and remember the first that answers.
 * GEMINI_MODEL puts a specific model first.
 */
import { extractJson } from './json.js';
import { LABEL_PROMPT, LINEUP_PROMPT, merchantPrompt, researchPrompt } from './prompts.js';
import { sanitizeLabel, sanitizeLabels, sanitizeMerchantPlaces, sanitizePriceHits, sanitizeWineInfo } from './sanitize.js';
import type { LabelRead, LlmProvider, MerchantPlaces, WebPriceHit, WineInfo, WineInfoQuery, WineQuery } from './types.js';

type FetchFn = typeof fetch;

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Pause before the one retry of an overloaded/rate-limited model (default 2 s). */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

class GeminiHttpError extends Error {
  constructor(readonly model: string, readonly status: number) {
    super(`Gemini ${model} HTTP ${status}`);
  }
}

/** Busy or rate-limited: worth one retry of the same model, never a walk through the others. */
const isTransient = (err: unknown) =>
  !(err instanceof GeminiHttpError) || err.status === 429 || err.status >= 500;

// Flash-Lite first: as accurate as Flash on real labels (2026-10 test), several times cheaper, and less often overloaded.
const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-flash-latest'];

function priceSearchPrompt(q: WineQuery): string {
  const wine = [q.displayName, q.vintage, q.region && `(${q.region})`].filter(Boolean).join(' ');
  return `Find current retail prices in the United States for this wine: ${wine}${q.bottleMl && q.bottleMl !== 750 ? `, ${q.bottleMl} ml bottle` : ''}.
Search online wine shops. Only include offers you actually found on a merchant's own product page; never estimate.
${q.vintage ? `Only include the ${q.vintage} vintage.` : ''}
Exclude auctions, restaurant prices, marketplace aggregators (wine-searcher, vivino) and non-US shops.
Reply with ONLY a JSON array (max 10 items, [] if none found):
[{"merchant": "shop name", "url": "product page URL", "price": 59.99, "currency": "USD",
  "vintage": "2019", "bottle_ml": 750, "pack_size": 1, "in_stock": true, "title": "product title as shown"}]`;
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly models: string[];
  private working: string | null = null;
  private readonly fetchImpl: FetchFn;

  constructor(private readonly opts: GeminiOptions) {
    this.models = [...new Set([opts.model, ...DEFAULT_MODELS].filter((m): m is string => Boolean(m)))];
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private url(model: string): string {
    return `${this.opts.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`;
  }

  private async generate(model: string, parts: unknown[], { grounded, json }: { grounded: boolean; json: boolean }): Promise<string> {
    const body: Record<string, unknown> = { contents: [{ role: 'user', parts }] };
    // Search grounding can't be combined with a forced JSON response type, so
    // grounded calls parse JSON out of plain text instead.
    if (grounded) body.tools = [{ google_search: {} }];
    else if (json) body.generationConfig = { responseMimeType: 'application/json', temperature: 0 };
    const resp = await this.fetchImpl(this.url(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 45000),
    });
    if (!resp.ok) throw new GeminiHttpError(model, resp.status);
    const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  }

  /**
   * Try models in order (last working first) until parse() accepts a reply.
   * Every attempt is a billed/quota-counted request, so: move to the next
   * model only when this one is gone (404) or gave an unusable reply; when it
   * is busy or rate-limited (429/5xx/timeout) retry it once after a pause and
   * then give up - other models share the key's quota. Other errors (bad key,
   * bad request) fail at once.
   */
  private async firstGood<T>(run: (model: string) => Promise<string>, parse: (text: string) => T | null): Promise<T> {
    const order = [...new Set([this.working, ...this.models].filter((m): m is string => Boolean(m)))];
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let retried = false;
    let lastErr: unknown = new Error('no usable reply');
    for (let i = 0; i < order.length; i++) {
      const model = order[i]!;
      try {
        const out = parse(await run(model));
        if (out !== null) {
          this.working = model;
          return out;
        }
      } catch (err) {
        lastErr = err;
        if (err instanceof GeminiHttpError && err.status === 404) {
          if (this.working === model) this.working = null;
          continue;
        }
        if (!isTransient(err) || retried) throw err;
        retried = true;
        await sleep(this.opts.retryDelayMs ?? 2000);
        i--; // same model once more
      }
    }
    throw lastErr;
  }

  readLabel(image: Buffer, mimeType: string): Promise<LabelRead> {
    const parts = [{ inline_data: { mime_type: mimeType, data: image.toString('base64') } }, { text: LABEL_PROMPT }];
    return this.firstGood(
      (m) => this.generate(m, parts, { grounded: false, json: true }),
      (text) => sanitizeLabel(extractJson(text, 'object'))
    );
  }

  readLabels(image: Buffer, mimeType: string): Promise<LabelRead[]> {
    const parts = [{ inline_data: { mime_type: mimeType, data: image.toString('base64') } }, { text: LINEUP_PROMPT }];
    return this.firstGood(
      (m) => this.generate(m, parts, { grounded: false, json: true }),
      (text) => sanitizeLabels(extractJson(text, 'object') ?? extractJson(text, 'array'))
    );
  }

  /**
   * With Google Search grounding when the key allows it (sources are real
   * pages); otherwise from the model's own knowledge, marked grounded: false.
   */
  async researchWine(q: WineInfoQuery): Promise<WineInfo> {
    const ask = (grounded: boolean) =>
      this.firstGood(
        (m) => this.generate(m, [{ text: researchPrompt(q, grounded) }], { grounded, json: !grounded }),
        (text) => sanitizeWineInfo(extractJson(text, 'object'), grounded)
      );
    try {
      return await ask(true);
    } catch {
      return ask(false);
    }
  }

  /** Web search only: store addresses and shipping states recalled from memory would be guesses. */
  researchMerchant(q: { name: string; domain: string }): Promise<MerchantPlaces> {
    return this.firstGood(
      (m) => this.generate(m, [{ text: merchantPrompt(q) }], { grounded: true, json: false }),
      (text) => sanitizeMerchantPlaces(extractJson(text, 'object'))
    );
  }

  searchPrices(q: WineQuery): Promise<WebPriceHit[]> {
    const parts = [{ text: priceSearchPrompt(q) }];
    return this.firstGood(
      (m) => this.generate(m, parts, { grounded: true, json: false }),
      (text) => {
        const arr = extractJson(text, 'array');
        return arr === null ? null : sanitizePriceHits(arr);
      }
    );
  }
}
