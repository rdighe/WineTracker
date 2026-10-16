/**
 * Turn a scraped/found offer into catalog + price data:
 * listing upsert -> title parse -> match (or create) wine -> observation.
 */
import type { Db } from '../db/pool.js';
import { createWine, type NewWine } from '../catalog/wines.js';
import { findGrape, isGrapeToken } from '../lib/grapes.js';
import { isBroadPlaceToken } from '../lib/places.js';
import { parseTitle, per750, type ParsedTitle } from '../lib/listing.js';
import { identityTokens, normalize } from '../lib/normalize.js';
import { matchWine } from '../match/matcher.js';
import type { ExtractedOffer } from './extract.js';

/** True when a title names no producer or cuvee - only grapes, places and descriptors ("Pinot Noir"). */
export function isGenericTitle(rest: string): boolean {
  return identityTokens(rest).every((t) => isGrapeToken(t) || isBroadPlaceToken(t));
}

/**
 * Text that identifies the wine. Shops (Shopify especially) often keep the
 * producer in the vendor field and title the product just "Pinot Noir"; then
 * the vendor is the only thing that tells two such wines apart.
 */
export function identityText(offer: ExtractedOffer, parsed: ParsedTitle, merchantName: string): { text: string; vendorProducer: string } {
  const vendor = offer.brand.trim();
  const nv = normalize(vendor);
  const isShop = !nv || nv === normalize(merchantName) || /^(red |white |rose |sparkling )?wines?$/.test(nv);
  if (!isShop && vendor.length <= 80 && isGenericTitle(parsed.rest) && !` ${normalize(parsed.rest)} `.includes(` ${normalize(vendor)} `)) {
    return { text: `${vendor} ${parsed.rest}`, vendorProducer: vendor };
  }
  return { text: parsed.rest, vendorProducer: '' };
}

const NON_WINE_CATEGORY =
  /spirit|whisk|bourbon|scotch|vodka|gin\b|tequila|mezcal|rum\b|brandy|cognac|liqueur|cordial|beer|cider|seltzer|sake|soju|accessor|glassware|gift card|food|snack|merch|apparel|cigar|mixer|non-?alcoholic|tobacco|event|ticket|class/i;

/** Shop category says this isn't wine (when the shop provides one). */
export function nonWineCategory(attributes: Record<string, string>): boolean {
  const c = attributes.category ?? '';
  return Boolean(c) && NON_WINE_CATEGORY.test(c) && !/wine|champagne|sparkling|port|sherry|madeira/i.test(c);
}

export async function ensureMerchant(db: Db, domain: string, name?: string): Promise<number> {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const { rows } = await db.query(
    `INSERT INTO merchants (domain, name) VALUES ($1, $2)
     ON CONFLICT (domain) DO UPDATE SET name = merchants.name RETURNING merchant_id`,
    [d, name || d]
  );
  return rows[0].merchant_id;
}

export interface IngestOptions {
  /** Create a catalog wine when nothing matches (seed crawl). */
  createWines: boolean;
  sourceType?: 'crawl' | 'web_search';
  confidence?: number;
  observedAt?: Date;
}

export type IngestStatus = 'priced' | 'review' | 'unmatched' | 'not_wine' | 'skipped_currency';

export interface IngestResult {
  listingId: number | null;
  wineId: number | null;
  status: IngestStatus;
  created: boolean;
}

const ATTR = (a: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) for (const [key, v] of Object.entries(a)) if (key.includes(k) && v) return v;
  return '';
};

/** Build a catalog entry from a retailer listing when nothing in the catalog matches. */
export function wineFromListing(offer: ExtractedOffer, parsed: ParsedTitle, merchantName: string): NewWine {
  const { vendorProducer } = identityText(offer, parsed, merchantName);
  const brand = vendorProducer || usableBrand(offer.brand, merchantName, offer.title);
  const restNorm = normalize(parsed.rest);
  let producer = '';
  let name = parsed.rest;
  if (vendorProducer) {
    producer = vendorProducer;
  } else if (brand && restNorm.includes(normalize(brand))) {
    producer = brand;
    const re = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    name = parsed.rest.replace(re, '').replace(/^[\s,:–—-]+|[\s,:–—-]+$/g, '').trim();
  }
  const a = offer.attributes;
  const colourAttr = ATTR(a, 'color', 'colour', 'type', 'category').toLowerCase();
  const colour = /ros[eé]/.test(colourAttr) ? 'rose' : /white|blanc/.test(colourAttr) ? 'white' : /red|rouge/.test(colourAttr) ? 'red' : '';
  return {
    producer,
    name,
    display_name: vendorProducer ? `${vendorProducer} ${parsed.rest}` : parsed.rest,
    country: ATTR(a, 'country'),
    region: ATTR(a, 'region', 'appellation'),
    grape: ATTR(a, 'varietal', 'grape', 'variety') || findGrape(normalize(parsed.rest)),
    colour,
    wine_type: /sparkling|champagne/.test(colourAttr) ? 'sparkling' : '',
    source: 'crawl',
  };
}

/**
 * The page's brand/vendor, only if it looks like the producer: shops often
 * put their own name or the importer there, so it must appear in the title.
 */
function usableBrand(brand: string, merchantName: string, title: string): string {
  const b = brand.trim();
  if (!b || b.length > 80) return '';
  const nb = normalize(b);
  if (!nb || nb === normalize(merchantName) || /^(wine|wines|n a|na|default)$/.test(nb)) return '';
  return ` ${normalize(title)} `.includes(` ${nb} `) ? b : '';
}

export async function ingestOffer(
  db: Db,
  args: { merchantId: number; merchantName: string; url: string; offer: ExtractedOffer },
  opts: IngestOptions
): Promise<IngestResult> {
  const { merchantId, merchantName, url, offer } = args;
  const currency = offer.currency || 'USD';
  const parsed = parseTitle(offer.title);

  // Upsert listing; keep an existing confirmed match unless the title changed.
  const { rows } = await db.query(
    `INSERT INTO listings (merchant_id, url, title, brand, sku, gtin, attributes, vintage_key, bottle_ml, pack_size,
                           last_price_cents, last_currency, last_in_stock, image_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (url) DO UPDATE SET
       wine_id = CASE WHEN listings.title = EXCLUDED.title THEN listings.wine_id ELSE NULL END,
       match_status = CASE WHEN listings.title = EXCLUDED.title THEN listings.match_status ELSE 'unmatched' END,
       title = EXCLUDED.title, brand = EXCLUDED.brand, sku = EXCLUDED.sku, gtin = EXCLUDED.gtin,
       attributes = EXCLUDED.attributes, vintage_key = EXCLUDED.vintage_key, bottle_ml = EXCLUDED.bottle_ml,
       pack_size = EXCLUDED.pack_size, last_price_cents = EXCLUDED.last_price_cents,
       last_currency = EXCLUDED.last_currency, last_in_stock = EXCLUDED.last_in_stock, last_seen_at = NOW(),
       image_url = COALESCE(EXCLUDED.image_url, listings.image_url)
     RETURNING listing_id, wine_id, match_status`,
    [merchantId, url, offer.title.slice(0, 500), offer.brand, offer.sku, offer.gtin, JSON.stringify(offer.attributes),
     parsed.vintageKey, parsed.bottleMl, parsed.packSize, offer.priceCents, currency, offer.inStock, offer.imageUrl ?? null]
  );
  const listing = rows[0];
  const listingId: number = listing.listing_id;

  if (!parsed.isWine || nonWineCategory(offer.attributes)) {
    await db.query(`UPDATE listings SET match_status = 'not_wine', wine_id = NULL WHERE listing_id = $1`, [listingId]);
    return { listingId, wineId: null, status: 'not_wine', created: false };
  }
  if (currency !== 'USD') return { listingId, wineId: null, status: 'skipped_currency', created: false };

  let wineId: number | null = listing.wine_id;
  let created = false;
  if (!wineId && listing.match_status !== 'review') {
    const { text, vendorProducer } = identityText(offer, parsed, merchantName);
    const brand = vendorProducer || usableBrand(offer.brand, merchantName, offer.title);
    const result = await matchWine(db, { text, producer: brand || undefined });
    const top = result.candidates.slice(0, 5).map((c) => ({ wine_id: c.wine.wine_id, display_name: c.wine.display_name, score: Number(c.score.toFixed(3)) }));
    let status: string;
    if (result.outcome === 'auto') {
      wineId = result.candidates[0]!.wine.wine_id;
      status = 'auto';
    } else if (opts.createWines) {
      // Bulk crawl: an uncertain match is nearly always a sibling wine (other
      // vineyard/cuvee of the same producer or appellation). A duplicate wine
      // is cheaper than mixing two wines' prices, and candidates are kept on
      // the listing for a later dedupe pass.
      wineId = await createWine(db, wineFromListing(offer, parsed, merchantName));
      created = true;
      status = 'auto';
    } else {
      status = result.outcome === 'choose' ? 'review' : 'unmatched';
    }
    await db.query(
      `UPDATE listings SET wine_id = $2, match_status = $3, match_score = $4, match_candidates = $5 WHERE listing_id = $1`,
      [listingId, wineId, status, result.candidates[0]?.score ?? null, JSON.stringify(top)]
    );
    if (!wineId) return { listingId, wineId: null, status: status === 'review' ? 'review' : 'unmatched', created };
  }
  if (!wineId) return { listingId, wineId: null, status: listing.match_status === 'review' ? 'review' : 'unmatched', created };

  await recordListingObservation(db, listingId, opts);
  return { listingId, wineId, status: 'priced', created };
}

/** Insert today's observation from a listing's latest offer (no-op if already recorded today at this price). */
export async function recordListingObservation(db: Db, listingId: number, opts: Pick<IngestOptions, 'sourceType' | 'confidence' | 'observedAt'> = {}): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO price_observations (wine_id, vintage_key, bottle_ml, pack_size, price_cents, unit_750_cents, currency,
                                     in_stock, source_type, merchant_id, listing_id, url, confidence, observed_at)
     SELECT l.wine_id, l.vintage_key, COALESCE(l.bottle_ml, 750), l.pack_size, l.last_price_cents, $2, l.last_currency,
            l.last_in_stock, $3, l.merchant_id, l.listing_id, l.url, $4, $5
       FROM listings l
      WHERE l.listing_id = $1 AND l.wine_id IS NOT NULL AND l.last_price_cents IS NOT NULL AND l.last_currency = 'USD'
     ON CONFLICT DO NOTHING`,
    [
      listingId,
      await unit750(db, listingId),
      opts.sourceType ?? 'crawl',
      opts.confidence ?? 1,
      opts.observedAt ?? new Date(),
    ]
  );
  return (rowCount ?? 0) > 0;
}

async function unit750(db: Db, listingId: number): Promise<number> {
  const { rows } = await db.query('SELECT last_price_cents, bottle_ml, pack_size FROM listings WHERE listing_id = $1', [listingId]);
  const l = rows[0];
  return l?.last_price_cents ? per750(l.last_price_cents, l.bottle_ml, l.pack_size) : 1;
}
