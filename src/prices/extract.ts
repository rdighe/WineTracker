/**
 * Extract a product offer from a retailer product page.
 *
 * Reads the structured data shops publish for search engines - schema.org
 * Product/Offer in JSON-LD first, then microdata, then Open Graph price
 * meta tags. No site-specific HTML scraping: if a page doesn't publish
 * structured data, we skip it rather than guess at its layout.
 */
import * as cheerio from 'cheerio';

export interface ExtractedOffer {
  title: string;
  brand: string;
  sku: string;
  gtin: string;
  priceCents: number;
  currency: string;
  inStock: boolean | null;
  attributes: Record<string, string>;
  via: 'jsonld' | 'microdata' | 'meta';
  /** The shop's product photo, when it publishes one. */
  imageUrl?: string;
}

/** First usable image URL from a schema.org image value (string, ImageObject, or a list of either). */
export function imageFrom(v: unknown): string | undefined {
  for (const x of asArray(v)) {
    const url = typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Json).url ?? (x as Json).contentUrl ?? (x as Json).src ?? '') : '';
    const clean = url.trim().replace(/^\/\//, 'https://');
    if (/^https?:\/\/\S+$/i.test(clean)) return clean;
  }
  return undefined;
}

type Json = Record<string, unknown>;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).replace(/\s+/g, ' ').trim();
  if (typeof v === 'object' && 'name' in (v as Json)) return text((v as Json).name);
  return '';
};
const isType = (node: Json, t: string) => asArray(node['@type']).some((x) => String(x).toLowerCase() === t.toLowerCase());

function parsePrice(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.,]/g, '');
  // "1,299.99" -> 1299.99 ; "59.99" -> 59.99 ; "1.299,99" (EU) -> 1299.99
  let n: number;
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function availability(v: unknown): boolean | null {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (/instock|in_stock|limitedavailability|onlineonly|instoreonly|presale|preorder/.test(s.replace(/\s/g, ''))) return true;
  if (/outofstock|soldout|discontinued/.test(s.replace(/\s/g, ''))) return false;
  return null;
}

/** Flatten @graph and nested arrays into a list of nodes. */
function nodes(data: unknown): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown) => {
    for (const item of asArray(v)) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Json;
      out.push(o);
      if (o['@graph']) walk(o['@graph']);
    }
  };
  walk(data);
  return out;
}

function offerFromProduct(p: Json): Omit<ExtractedOffer, 'via'> | null {
  // Pick the first offer with a USD-or-unspecified price; AggregateOffer -> lowPrice.
  let priceCents: number | null = null;
  let currency = '';
  let inStock: boolean | null = null;
  for (const raw of asArray(p.offers)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Json;
    const inner = isType(o, 'AggregateOffer') && o.offers ? asArray(o.offers)[0] as Json | undefined : undefined;
    const spec = asArray(o.priceSpecification)[0] as Json | undefined;
    const price = parsePrice(o.price ?? inner?.price ?? spec?.price ?? (isType(o, 'AggregateOffer') ? o.lowPrice : undefined));
    if (price == null) continue;
    priceCents = price;
    currency = text(o.priceCurrency ?? inner?.priceCurrency ?? spec?.priceCurrency).toUpperCase();
    inStock = availability(o.availability ?? inner?.availability);
    break;
  }
  if (priceCents == null) return null;
  const attributes: Record<string, string> = {};
  for (const prop of asArray(p.additionalProperty)) {
    if (prop && typeof prop === 'object') {
      const k = text((prop as Json).name).toLowerCase();
      const v = text((prop as Json).value);
      if (k && v && Object.keys(attributes).length < 20) attributes[k] = v.slice(0, 120);
    }
  }
  const category = text(p.category);
  if (category) attributes.category = category.slice(0, 120);
  return {
    title: text(p.name),
    brand: text(p.brand ?? p.manufacturer),
    sku: text(p.sku ?? p.mpn),
    gtin: text(p.gtin13 ?? p.gtin12 ?? p.gtin14 ?? p.gtin8 ?? p.gtin),
    priceCents,
    currency,
    inStock,
    attributes,
    imageUrl: imageFrom(p.image),
  };
}

export function extractOffer(html: string): ExtractedOffer | null {
  const $ = cheerio.load(html);

  // 1. JSON-LD
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try {
      data = JSON.parse($(el).text().trim());
    } catch {
      continue;
    }
    for (const node of nodes(data)) {
      if (!isType(node, 'Product') && !isType(node, 'ProductGroup')) continue;
      const offer = offerFromProduct(node) ?? (node.hasVariant ? asArray(node.hasVariant).map((v) => offerFromProduct(v as Json)).find(Boolean) ?? null : null);
      if (offer && offer.title) return { ...offer, via: 'jsonld' };
    }
  }

  // 2. Microdata
  const product = $('[itemscope][itemtype*="schema.org/Product"]').first();
  if (product.length) {
    const prop = (name: string) => {
      const el = product.find(`[itemprop="${name}"]`).first();
      return (el.attr('content') ?? el.attr('href') ?? el.text() ?? '').trim();
    };
    const priceCents = parsePrice(prop('price'));
    const title = prop('name');
    if (priceCents != null && title) {
      return {
        title,
        brand: prop('brand'),
        sku: prop('sku'),
        gtin: prop('gtin13') || prop('gtin12'),
        priceCents,
        currency: prop('priceCurrency').toUpperCase(),
        inStock: availability(prop('availability')),
        attributes: {},
        via: 'microdata',
        imageUrl: imageFrom(product.find('[itemprop="image"]').first().attr('src') ?? prop('image')),
      };
    }
  }

  // 3. Open Graph / product meta tags
  const meta = (p: string) => ($(`meta[property="${p}"]`).attr('content') ?? $(`meta[name="${p}"]`).attr('content') ?? '').trim();
  const ogPrice = parsePrice(meta('product:price:amount') || meta('og:price:amount'));
  const ogTitle = meta('og:title');
  if (ogPrice != null && ogTitle) {
    return {
      title: ogTitle,
      brand: meta('product:brand'),
      sku: meta('product:retailer_item_id'),
      gtin: '',
      priceCents: ogPrice,
      currency: (meta('product:price:currency') || meta('og:price:currency')).toUpperCase(),
      inStock: availability(meta('product:availability') || meta('og:availability')),
      attributes: {},
      via: 'meta',
      imageUrl: imageFrom(meta('og:image')),
    };
  }
  return null;
}
