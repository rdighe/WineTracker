/**
 * Shopify stores expose their catalog at /products.json (the same data their
 * storefront renders). One request returns up to 250 products, so a whole
 * store costs tens of requests instead of thousands of page loads.
 */
import { getWithRetry, type PoliteFetcher } from './fetcher.js';
import { imageFrom, type ExtractedOffer } from './extract.js';

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  available?: boolean;
  sku?: string | null;
  featured_image?: { src?: string } | null;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  tags: string[] | string;
  variants: ShopifyVariant[];
  images?: Array<{ src?: string }>;
}

const TAG_KEYS: Array<[RegExp, string]> = [
  [/^(country)$/i, 'country'],
  [/^(region|appellation|sub[-_ ]?region)$/i, 'region'],
  [/^(varietal|grape|variety|varietals)$/i, 'varietal'],
  [/^(color|colour|type|wine[-_ ]?type|style)$/i, 'type'],
];

/** Tags like "Country_France", "Region: Burgundy", "varietal-pinot noir". */
export function tagAttributes(tags: string[] | string): Record<string, string> {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const out: Record<string, string> = {};
  for (const raw of list) {
    const m = String(raw).trim().match(/^([A-Za-z -]{3,20}?)\s*[:_]\s*(.{2,60})$/);
    if (!m) continue;
    for (const [re, key] of TAG_KEYS) {
      if (re.test(m[1]!.trim()) && !out[key]) out[key] = m[2]!.trim();
    }
  }
  return out;
}

export function offersFromProduct(p: ShopifyProduct, origin: string): Array<{ url: string; offer: ExtractedOffer }> {
  const attributes = { ...tagAttributes(p.tags), ...(p.product_type ? { category: p.product_type.slice(0, 120) } : {}) };
  const out: Array<{ url: string; offer: ExtractedOffer }> = [];
  const multi = p.variants.length > 1;
  for (const v of p.variants) {
    const price = Number(v.price);
    if (!(price > 0)) continue;
    const vt = v.title && v.title !== 'Default Title' ? v.title : '';
    out.push({
      url: multi ? `${origin}/products/${p.handle}?variant=${v.id}` : `${origin}/products/${p.handle}`,
      offer: {
        title: vt ? `${p.title} ${vt}` : p.title,
        brand: p.vendor ?? '',
        sku: v.sku ?? '',
        gtin: '',
        priceCents: Math.round(price * 100),
        currency: 'USD', // products.json carries no currency; these are US stores
        inStock: typeof v.available === 'boolean' ? v.available : null,
        attributes,
        via: 'jsonld',
        imageUrl: imageFrom(v.featured_image?.src) ?? imageFrom(p.images?.[0]?.src),
      },
    });
  }
  return out;
}

/** Yield pages of products until the feed runs out (or robots.txt says no). */
export async function* shopifyProducts(fetcher: PoliteFetcher, origin: string, maxPages = 400, startPage = 1): AsyncGenerator<ShopifyProduct[]> {
  for (let page = startPage; page <= maxPages; page++) {
    const r = await getWithRetry(fetcher, `${origin}/products.json?limit=250&page=${page}`, 'application/json');
    if (r.status !== 200) throw new Error(`products.json page ${page}: HTTP ${r.status}`);
    const products = (JSON.parse(r.body) as { products?: ShopifyProduct[] }).products ?? [];
    if (!products.length) return;
    yield products;
  }
}
