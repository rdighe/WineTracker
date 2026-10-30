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
  /** Cellar entries: which cellar, where on a rack, the receipt, who added it (when not you), and whether you may change it. */
  cellar_id?: number | null;
  receipt_id?: number | null;
  places?: Place[] | null;
  added_by?: string | null;
  can_edit?: boolean;
  /** The community note shared from this tasting, if any. */
  note_id?: number | null;
}

export interface Place { rackId: number; rack: string; row: number; col: number }

export type CellarRole = 'owner' | 'editor' | 'viewer';

export interface Cellar {
  cellarId: number;
  name: string;
  role: CellarRole;
  bottles: number;
  wines: number;
  /** What the bottles cost, and their value now (market, or what was paid where no market price). */
  costCents: number;
  valueCents: number;
  /** Cost and value of the bottles with both prices: the change in value. */
  pairedCostCents: number;
  pairedValueCents: number;
  /** Bottles with no market price. */
  unpriced: number;
  racks: number;
  receipts: number;
  members: { userId: number; name: string; role: CellarRole; me: boolean }[];
}

export interface RackSlot { row: number; col: number; tastingId: number; wineId: number; name: string; vintage: string | null; colour: string; wineType: string }
export interface Rack { rackId: number; name: string; rows: number; cols: number; slots: RackSlot[] }

export interface InvitePreview { cellarName: string; from: string; role: CellarRole; member: boolean }

export interface ReceiptLine {
  index: number;
  text: string;
  producer: string;
  name: string;
  vintage: string;
  qty: number;
  unitCents: number | null;
  bottleMl: number | null;
  match: 'matched' | 'likely' | 'guess';
  wineId: number | null;
  displayName: string;
  region: string;
  style: string;
  imageUrl: string | null;
  retailCents: number | null;
}

export interface ReceiptRead { merchant: string; purchasedOn: string | null; totalCents: number | null; source: string; lines: ReceiptLine[] }

export interface Receipt {
  receiptId: number;
  cellarId: number | null;
  cellarName: string | null;
  merchant: string;
  purchasedOn: string | null;
  totalCents: number | null;
  hasPhoto: boolean;
  bottles: number;
  lines: number;
}

export interface ReceiptDetail extends Receipt {
  entries: { tasting_id: number; wine_id: number; display_name: string; colour: string; wine_type: string; vintage_key: string | null; kind: 'tasted' | 'cellar'; bottles: number | null; price_paid_cents: number | null; bottle_ml: number; image_url: string | null }[];
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
  fit?: Fit;
}

/** A bottle in the person's cellar, scored for an occasion (GET /api/cellar/picks). */
export interface CellarPick {
  wineId: number;
  displayName: string;
  region: string;
  style: RecStyle | '';
  imageUrl: string | null;
  /** Vintages held, newest first. */
  vintages: string[];
  bottles: number;
  /** Where the bottles are, as written when they were added. */
  location: string;
  /** Where one sits on a rack ("Kitchen · row 2, place 3"), when placed. */
  place: string | null;
  /** The cellar it's in, when the person has more than one. */
  cellar: string | null;
  medianCents: number | null;
  myRating: number | null;
  score: number;
  reasons: string[];
  fit?: Fit;
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

/** One wine on a wine list or a store shelf, as read (prices in cents, as printed). */
export interface ListEntry {
  producer: string;
  name: string;
  vintage: string;
  region: string;
  country: string;
  grape: string;
  colour: string;
  style: string;
  section: string;
  glassCents: number | null;
  bottleCents: number | null;
  bottleMl: number | null;
  text: string;
}

/** A wine on a list or shelf, ranked for the person (POST /api/picks). */
export interface PickItem {
  index: number;
  entry: ListEntry;
  /** matched: this wine; likely: probably this wine; guess: not in the catalog, judged by what's printed. */
  match: 'matched' | 'likely' | 'guess';
  wineId: number | null;
  displayName: string;
  region: string;
  style: RecStyle | '';
  imageUrl: string | null;
  score: number | null;
  reasons: string[];
  myRating: number | null;
  retailCents: number | null;
  retailVintage: string | null;
  /** List price over typical retail (a glass counts as a fifth of a bottle); matched wines only. */
  markup: number | null;
  glassMarkup: number | null;
  fit?: Fit | null;
}

export interface PickResult {
  pickId: number;
  kind: 'list' | 'shelf';
  source: string;
  mode: 'profile' | 'locked';
  rated: number;
  items: PickItem[];
}

/** A saved wine list or shelf (GET /api/picks). */
export interface SavedPick {
  pickId: number;
  kind: 'list' | 'shelf';
  name: string;
  savedAt: string;
  wines: number;
  photos: number;
  topPick: string;
}

/** A wine list or shelf being ranked on the server (POST /api/picks with a ref). */
export interface PickJob {
  ref: string;
  status: 'pending' | 'done' | 'failed';
}

export type Reaction = 'love' | 'fine' | 'dislike' | 'unknown';
export type Budget = 'under20' | '20to40' | '40to80' | 'over80';
export interface Archetype { key: string; title: string; detail: string; style: RecStyle }
export interface TastePrefs { styles: RecStyle[]; budget: Budget | null; seeds: Partial<Record<string, Reaction>>; doneAt: string | null; skipped: boolean }
export interface Onboarding extends TastePrefs { tastings: number; rated: number; archetypes: Archetype[] }

/**
 * How likely they are to enjoy a wine (server: src/recs/fit.ts): a percentage
 * in steps of 5 (null when confidence is low), a band, what it rests on, and
 * how confident it is.
 */
export interface Fit { percent: number | null; band: 'strong' | 'good' | 'maybe' | 'unlikely'; basis: number; confidence: 'high' | 'medium' | 'low' }

export type NoteReaction = 'loved' | 'liked' | 'okay' | 'not_for_me';
export type NoteMaturity = 'too_young' | 'ready' | 'peak' | 'past_prime';
/** A view on a wine shared with the community: words, never a score. */
export interface CommunityNote {
  noteId: number;
  author: { name: string; notes: number; me: boolean };
  wine: { wineId: number; displayName: string; region: string; country: string; colour: string; wineType: string; imageUrl: string | null; medianCents: number | null };
  vintage: string | null;
  reaction: NoteReaction;
  maturity: NoteMaturity | null;
  body: string;
  createdAt: string;
  edited: boolean;
  hidden: boolean;
  likes: number;
  liked: boolean;
  replies: number;
}
export interface NoteReply { replyId: number; author: { name: string; me: boolean }; body: string; createdAt: string }

export type CtPart = 'collection' | 'pending' | 'wishlist' | 'notes' | 'history';
export interface CtSummary {
  parts: Partial<Record<CtPart, { rows: number; imported: number; alreadyImported: number; bottles?: number }>>;
  matched: number;
  addedWines: number;
  addedNames: string[];
}

/** Flavor families (server: src/recs/flavors.ts), for the taste editor. */
export const FLAVOR_LABELS: Record<string, string> = {
  black_fruit: 'black fruit', red_fruit: 'red fruit', citrus: 'citrus', orchard: 'apple & pear', stone_fruit: 'stone fruit', tropical: 'tropical fruit',
  floral: 'floral', herbal: 'herbal', earthy: 'earthy', mineral: 'mineral', oak: 'oaky', spice: 'spicy', savory: 'savory', rich_sweet: 'honeyed',
  yeasty: 'brioche', tannic: 'firm tannins', fresh: 'high acidity', full: 'full-bodied', light: 'light & elegant', sweet: 'sweet',
};

export interface TasteCard {
  name: string;
  rated: number;
  likes: { key: string; label: string; strength: number }[];
  dislikes: { key: string; label: string }[];
  styles: RecStyle[];
  priceLowCents: number | null;
  priceHighCents: number | null;
  grapes: string[];
  places: string[];
  favorites: { wineId: number; name: string; vintage: string | null }[];
  edits?: { likedFlavors: string[]; dislikedFlavors: string[]; avoid: string[]; budget: Budget | null; budgetFixed: boolean; styles: RecStyle[] };
}
export interface TasteComparison {
  /** null until both have rated a few wines. */
  similarity: number | null;
  shared: string[];
  bothLoved: { wineId: number; name: string }[];
  theyLoveYouHavent: { wineId: number; name: string; vintage: string | null }[];
}
export interface SharedTaste { userId: number; me: boolean; friend: boolean; card: TasteCard; comparison: TasteComparison | null }
