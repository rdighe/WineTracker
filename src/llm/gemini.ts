/**
 * Gemini provider (Google AI Studio API).
 *
 * Same approach as Wine Circle's wineResearch.js: Google renames and retires
 * models, so try a ranked list and remember the first that answers.
 * GEMINI_MODEL puts a specific model first.
 */
import { extractJson } from './json.js';
import { sanitizeLabel, sanitizePriceHits } from './sanitize.js';
import type { LabelRead, LlmProvider, WebPriceHit, WineQuery } from './types.js';

type FetchFn = typeof fetch;

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

const LABEL_PROMPT = `You are reading a photo of a wine bottle label.
Return ONLY a JSON object with these keys:
{"producer": "", "name": "", "vintage": "", "region": "", "country": "", "grape": "",
 "colour": "red|white|rose|", "bottle_ml": null, "raw_text": "", "confidence": 0.0}
Rules:
- producer: the winery/house/chateau exactly as printed (e.g. "Château Lynch-Bages").
- name: the specific wine or cuvée name, without the producer (e.g. "Special Selection"); "" if the wine is just the producer's name.
- vintage: the 4-digit year printed on the label, "NV" if it says non-vintage, "" if no year is visible. Never guess a year.
- region / country / grape: only if printed or certain from the appellation on the label.
- bottle_ml: only if a volume is printed (750 ml -> 750, 1.5 L -> 1500).
- raw_text: all other legible label text, space-separated.
- confidence: your probability (0-1) that producer, name and vintage are all correct.
If the image is not a wine label, return all empty strings and confidence 0.`;

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
    if (!resp.ok) throw new Error(`Gemini ${model} HTTP ${resp.status}`);
    const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  }

  /** Try models in order (last working first) until parse() accepts a reply. */
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
