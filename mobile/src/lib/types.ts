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
  /** With a location: is the shop close by (miles away, when known) or does it ship there; null if neither. */
  nearby?: { local: boolean; miles: number | null; city: string; ships: boolean } | null;
}

/** How a location-aware request went: applied false when nothing was near, so everything is shown; pending: shops still being looked up. */
export interface NearResult { applied: boolean; state: string; pending: number }

export interface PricesResponse {
  summary: PriceSummary | null;
  history: { day: string; median_cents: number; n: number }[];
  offers: Offer[];
  near?: NearResult;
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

/** For you's styles; sweet covers dessert and fortified wines. */
export type RecStyle = 'red' | 'white' | 'rose' | 'sparkling' | 'orange' | 'sweet';

export interface Recommendation {
  wineId: number;
  displayName: string;
  region: string;
  country: string;
  colour?: string;
  wineType?: string;
  /** red | white | rose | sparkling | orange | sweet, or '' when unknown. */
  style?: RecStyle | '';
  imageUrl?: string | null;
  /** With a location: the closest way to get it. */
  nearby?: { shop: string; local: boolean; miles: number | null; city: string; ships: boolean };
  medianCents: number;
  nMerchants: number;
  score: number;
  reasons: string[];
}

/** What suggestions are based on: the rated wines' styles, usual price band and leading flavors. */
export interface TasteSummary {
  rated: number;
  styles: RecStyle[];
  priceLowCents: number | null;
  priceHighCents: number | null;
  flavors: string[];
}

/** "Find wines": what a search (and a saved view) asks for. Prices in dollars. */
export interface RecSearch {
  styles?: RecStyle[];
  minPrice?: number;
  maxPrice?: number;
  region?: string;
  notes?: string;
  food?: string;
}

export interface RecView {
  viewId: number;
  name: string;
  criteria: RecSearch;
  createdAt: string;
}

/** styles: the ones the user has liked, best-liked first. Older servers send no styles or summary. */
export type RecommendationsResponse =
  | { mode: 'profile'; items: Recommendation[]; styles?: RecStyle[]; summary?: TasteSummary; near?: NearResult }
  | { mode: 'locked'; rated: number; needed: number; items: [] };

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
  /** Spec / technical sheets found on the web. Missing in research from before they were looked up. */
  specSheets?: { title: string; url: string }[];
  /** What individual sources say it tastes like, corroborating tastingNotes. */
  tastingSources?: { source: string; url: string; kind: 'producer' | 'importer' | 'critic' | 'retailer' | 'other'; notes: string }[];
  /** Where those sources agree and differ. */
  consensus?: string;
  /** False: from the model's general knowledge, not a web search. */
  grounded: boolean;
}

export interface InfoResponse {
  /** none: not researched yet (sign in to start); unavailable: the server can't research. */
  status: 'ready' | 'pending' | 'failed' | 'none' | 'unavailable';
  /** Present while research is redone (refreshing) or after a retry failed, too: the earlier research. */
  info: WineInfo | null;
  /** Looking again (spec sheets, more sources) while showing what's known. */
  refreshing?: boolean;
}

/** A wine bookmarked on its page (My wines › Saved). Price is per 750 ml, all vintages. */
export interface SavedWine {
  wine_id: number;
  vintage_key: string;
  display_name: string;
  producer: string;
  region: string;
  sub_region: string;
  country: string;
  colour: string;
  wine_type: string;
  image_url: string | null;
  median_cents: number | null;
  n_merchants: number | null;
  created_at: string;
}
