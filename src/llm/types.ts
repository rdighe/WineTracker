/**
 * Provider-agnostic interface for the three LLM jobs in WineTracker. Callers
 * depend only on this file; providers (Gemini, OpenRouter; others later)
 * live next to it and are picked in index.ts.
 */

export interface LabelRead {
  producer: string;
  name: string;            // cuvee / wine name, without the producer
  vintage: string;         // '2015', 'NV', or '' if not visible
  region: string;
  country: string;
  grape: string;
  colour: string;          // red | white | rose | ''
  bottleMl: number | null;
  rawText: string;         // all legible label text, for the matcher
  confidence: number;      // 0..1, model's own estimate that the fields are right
}

export interface WebPriceHit {
  merchant: string;
  url: string;
  priceCents: number;
  currency: string;
  vintage: string;         // as stated on the page: year, 'NV' or ''
  bottleMl: number | null;
  packSize: number;
  inStock: boolean | null;
  title: string;           // product title as shown by the merchant
}

export interface WineQuery {
  displayName: string;
  vintage: string | null;
  region?: string;
  bottleMl?: number;
}

export interface LlmProvider {
  readonly name: string;
  /** Read a wine label photo. */
  readLabel(image: Buffer, mimeType: string): Promise<LabelRead>;
  /** Search the web for current US retail offers for one wine. */
  searchPrices(q: WineQuery): Promise<WebPriceHit[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'No LLM provider is configured') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
