// Shapes returned by the WineTracker API (see ../../src/api/app.ts).

export interface Candidate {
  wineId: number;
  displayName: string;
  region: string;
  country: string;
  score: number;
  shops?: number;
}

export interface LabelRead {
  producer: string;
  name: string;
  vintage: string;
  region: string;
  country: string;
  grape: string;
  colour: string;
  bottleMl: number | null;
  rawText: string;
  confidence: number;
}

export interface ScanResult {
  scanId: number;
  read: LabelRead;
  outcome: 'auto' | 'choose' | 'new';
  vintage: string | null;
  bottleMl: number | null;
  candidates: Candidate[];
  /** 'ocr', 'ocr-learned', 'ocr-fuzzy': identified from the phone's text; else the server's LLM read it. */
  source?: string;
}

export interface PriceSummary {
  vintage_key: string;
  median_cents: number;
  p10_cents: number;
  p90_cents: number;
  n_observations: number;
  n_merchants: number;
  window_days: number;
  latest_observed_at: string;
  /** No shop has this in stock: the price comes from out-of-stock listings. */
  out_of_stock_only?: boolean;
}

export interface Wine {
  wine_id: number;
  display_name: string;
  producer: string;
  name: string;
  region: string;
  sub_region: string;
  country: string;
  colour: string;
  wine_type?: string;
  grape: string;
  lwin: string | null;
  /** Reference photo (a shop's packshot on white); image_match says how close it is. */
  image_url?: string | null;
  image_match?: 'vintage' | 'wine' | 'producer' | null;
}

export interface Offer {
  merchant: string | null;
  vintage_key: string | null;
  bottle_ml: number;
  price_cents: number;
  unit_750_cents: number;
  in_stock: boolean | null;
  source_type: string;
  url: string;
  observed_at: string;
}

export interface PricesResponse {
  summary: PriceSummary | null;
  history: { day: string; median_cents: number; n: number }[];
  offers: Offer[];
}

export interface Tasting {
  tasting_id: number;
  wine_id: number;
  display_name: string;
  producer: string;
  colour: string;
  grape: string;
  wine_type: string;
  region: string;
  sub_region?: string;
  country: string;
  vintage_key: string | null;
  rating: number | null;
  notes: string;
  tags: string[];
  price_paid_cents: number | null;
  price_context: 'retail' | 'restaurant' | null;
  paid_750_cents: number | null;
  market_now_cents: number | null;
  market_vintage_key: string | null;
  tasted_on: string;
  kind: 'tasted' | 'cellar';
  bottles: number | null;
  setting: TastingSetting | null;
  image_url: string | null;
}

export type TastingSetting = 'home' | 'restaurant' | 'other';

export interface ImportSummary {
  rows: number;
  imported: number;
  alreadyImported: number;
  matched: number;
  addedWines: number;
  skipped: number;
  addedNames: string[];
  missingColumns: string[];
}

export interface Recommendation {
  wineId: number;
  displayName: string;
  region: string;
  country: string;
  colour?: string;
  wineType?: string;
  imageUrl?: string | null;
  medianCents: number;
  nMerchants: number;
  score: number;
  reasons: string[];
}

/** Researched background for a wine (see ../../src/llm/types.ts). Any field may be empty. */
export interface WineInfo {
  summary: string;
  tastingNotes: { appearance: string; nose: string; palate: string; finish: string };
  descriptors: string[];
  foodPairings: string[];
  serving: { temperature: string; decant: string; drinkingWindow: string };
  producer: { history: string; founded: string; location: string; website: string };
  vineyard: string;
  specs: { grapes: string; abv: string; aging: string; vinification: string; soil: string; production: string };
  sources: { title: string; url: string }[];
  /** False: from the model's general knowledge, not a web search. */
  grounded: boolean;
}

export interface InfoResponse {
  /** none: not researched yet (sign in to start); unavailable: the server can't research. */
  status: 'ready' | 'pending' | 'failed' | 'none' | 'unavailable';
  info: WineInfo | null;
}
