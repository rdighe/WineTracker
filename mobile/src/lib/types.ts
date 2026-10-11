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
  grape: string;
  lwin: string | null;
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
  region: string;
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
}

export interface Recommendation {
  wineId: number;
  displayName: string;
  region: string;
  country: string;
  medianCents: number;
  nMerchants: number;
  score: number;
  reasons: string[];
}
