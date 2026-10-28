/**
 * Provider-agnostic interface for the LLM jobs in WineTracker. Callers
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

/** What we know about a wine before researching it. */
export interface WineInfoQuery {
  displayName: string;
  producer: string;
  region: string;
  country: string;
  grape: string;
  colour: string;
  /** Text read off a label of this wine, when someone scanned it: tells apart wines that share a name. */
  labelText?: string;
}

/**
 * Researched background for a wine (not a vintage): tasting notes, the
 * producer's story, technical specs. Every field may be empty: the model is
 * told to leave out what it can't back up.
 */
export interface WineInfo {
  summary: string;
  tastingNotes: { appearance: string; nose: string; palate: string; finish: string };
  /** Short tasting descriptors ("black cherry", "graphite"), offered as tags. */
  descriptors: string[];
  foodPairings: string[];
  serving: { temperature: string; decant: string; drinkingWindow: string };
  producer: { history: string; founded: string; location: string; website: string };
  /** Vineyards, site and terroir. */
  vineyard: string;
  specs: { grapes: string; abv: string; aging: string; vinification: string; soil: string; production: string };
  /** Catalog facts, used to fill blanks on catalog entries created from shop listings. */
  wine: { colour: string; wineType: string; country: string; region: string; subRegion: string; grape: string };
  sources: { title: string; url: string }[];
  /** Technical / spec sheets found for the wine (producer or importer fact sheets, often PDFs). */
  specSheets: { title: string; url: string }[];
  /**
   * What individual sources say it tastes like, to corroborate tastingNotes:
   * the producer's or importer's sheet, critics, shops. Grounded research only.
   */
  tastingSources: { source: string; url: string; kind: 'producer' | 'importer' | 'critic' | 'retailer' | 'other'; notes: string }[];
  /** Where those sources agree and where they differ, one or two sentences. */
  consensus: string;
  /** True when the model searched the web; false when it answered from what it already knew. */
  grounded: boolean;
  /** Research format (INFO_VERSION in src/catalog/info.ts); older research is redone when the wine is opened. */
  version?: number;
}

/** Where a wine shop is and where it ships (researched from the web). */
export interface MerchantPlaces {
  stores: { name: string; address: string; city: string; state: string; postal: string; lat: number | null; lng: number | null }[];
  /** Two-letter US state codes it ships wine to. */
  shipsTo: string[];
  sources: { title: string; url: string }[];
}

export interface LlmProvider {
  readonly name: string;
  /** Read a wine label photo. */
  readLabel(image: Buffer, mimeType: string): Promise<LabelRead>;
  /** Read every bottle label in a photo of several bottles, left to right. Providers that can't, leave it out. */
  readLabels?(image: Buffer, mimeType: string): Promise<LabelRead[]>;
  /** Search the web for current US retail offers for one wine. */
  searchPrices(q: WineQuery): Promise<WebPriceHit[]>;
  /** Research a wine's tasting notes, producer and specs. Providers that can't, leave it out. */
  researchWine?(q: WineInfoQuery): Promise<WineInfo>;
  /** Find a shop's physical stores and the states it ships to. Providers that can't search the web, leave it out. */
  researchMerchant?(q: { name: string; domain: string }): Promise<MerchantPlaces>;
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'No LLM provider is configured') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
