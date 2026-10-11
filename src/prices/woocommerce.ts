/**
 * WooCommerce stores publish their catalog through the public Store API
 * (/wp-json/wc/store/v1/products) - the same endpoint their block-based
 * storefront uses. 100 products per request.
 */
import type { ExtractedOffer } from './extract.js';
import { getWithRetry, type PoliteFetcher } from './fetcher.js';

interface WooProduct {
  name: string;
  permalink: string;
  sku?: string;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  is_in_stock?: boolean;
  categories?: Array<{ name: string }>;
  brands?: Array<{ name: string }>;
  attributes?: Array<{ name: string; terms?: Array<{ name: string }> }>;
}

const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function offerFromWoo(p: WooProduct): { url: string; offer: ExtractedOffer } | null {
  const minor = p.prices?.currency_minor_unit ?? 2;
  const raw = Number(p.prices?.price);
  if (!p.permalink || !p.name || !(raw > 0)) return null;
  const attributes: Record<string, string> = {};
  for (const a of p.attributes ?? []) {
    const v = (a.terms ?? []).map((t) => t.name).join(', ');
    if (a.name && v) attributes[a.name.toLowerCase().slice(0, 40)] = decode(v).slice(0, 120);
  }
  const cats = (p.categories ?? []).map((c) => decode(c.name)).join(', ');
  if (cats) attributes.category = cats.slice(0, 120);
  return {
    url: p.permalink,
    offer: {
      title: decode(p.name),
      brand: decode(p.brands?.[0]?.name ?? ''),
      sku: p.sku ?? '',
      gtin: '',
      priceCents: Math.round(raw * 10 ** (2 - minor)),
      currency: (p.prices?.currency_code ?? 'USD').toUpperCase(),
      inStock: typeof p.is_in_stock === 'boolean' ? p.is_in_stock : null,
      attributes,
      via: 'jsonld',
    },
  };
}

export async function* wooProducts(fetcher: PoliteFetcher, origin: string, maxPages = 2000, startPage = 1): AsyncGenerator<WooProduct[]> {
  for (let page = startPage; page <= maxPages; page++) {
    const r = await getWithRetry(fetcher, `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}&orderby=id&order=asc`, 'application/json');
    if (r.status === 400 && page > 1) return; // past the last page
    if (r.status !== 200) throw new Error(`store api page ${page}: HTTP ${r.status}`);
    const products = JSON.parse(r.body) as WooProduct[];
    if (!Array.isArray(products) || !products.length) return;
    yield products;
  }
}
