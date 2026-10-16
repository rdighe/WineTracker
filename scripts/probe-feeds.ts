/**
 * Probe candidate retailers for a catalog feed we can crawl politely:
 * Shopify /products.json or the WooCommerce Store API. For each domain:
 * robots.txt permission, which feed answers, how much of a sample looks like
 * wine, and any lines in the terms of service about scraping or automated
 * access (for a person to read before adding the shop to src/prices/sites.ts).
 *
 *   tsx scripts/probe-feeds.ts domain1 domain2 ...
 */
import * as cheerio from 'cheerio';
import { config } from '../src/config.js';
import { parseTitle } from '../src/lib/listing.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';

const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 1500, timeoutMs: 15000, blockAfter: 2 });
const TOS_PATHS = ['/policies/terms-of-service', '/pages/terms-of-service', '/pages/terms-and-conditions', '/terms-of-service', '/terms-and-conditions', '/terms', '/terms-of-use'];
const TOS_WORDS = /(scrap|crawl|spider|robot|data[- ]mining|automated (means|access|system|tool)|harvest|bots?\b)/i;

async function json(url: string): Promise<unknown | null> {
  try {
    if (!(await fetcher.isAllowed(url))) {
      // The fetcher also refuses a host whose robots.txt can't be read (no such domain, connection refused).
      const reachable = await fetch(new URL('/robots.txt', url), { signal: AbortSignal.timeout(10000) }).then(() => true, () => false);
      return reachable ? 'disallowed' : 'unreachable';
    }
    const r = await fetcher.get(url, 'application/json');
    if (r.status !== 200) return null;
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

async function tos(origin: string): Promise<{ url: string; lines: string[] } | null> {
  for (const path of TOS_PATHS) {
    try {
      if (!(await fetcher.isAllowed(origin + path))) continue;
      const r = await fetcher.get(origin + path, 'text/html');
      if (r.status !== 200 || r.body.length < 2000) continue;
      const text = cheerio.load(r.body)('body').text().replace(/\s+/g, ' ');
      if (!/terms/i.test(text)) continue;
      const lines = text.split(/(?<=[.;])\s+/).filter((s) => TOS_WORDS.test(s)).map((s) => s.trim().slice(0, 300)).slice(0, 4);
      return { url: origin + path, lines };
    } catch {
      // try the next path
    }
  }
  return null;
}

async function probe(domain: string) {
  const origin = `https://${domain}`;
  const out: Record<string, unknown> = { domain };
  const shop = (await json(`${origin}/products.json?limit=30`)) as { products?: Array<{ title: string; product_type?: string }> } | string | null;
  if (shop === 'unreachable') out.error = 'unreachable';
  else if (shop === 'disallowed') out.shopify = 'disallowed by robots.txt';
  else if (shop && typeof shop === 'object' && Array.isArray(shop.products)) {
    out.kind = 'shopify';
    out.sample = shop.products.length;
    out.wineShare = shop.products.length ? +(shop.products.filter((p) => parseTitle(p.title).isWine).length / shop.products.length).toFixed(2) : 0;
    out.examples = shop.products.slice(0, 3).map((p) => p.title);
  } else {
    const woo = await json(`${origin}/wp-json/wc/store/v1/products?per_page=30`);
    if (woo === 'disallowed') out.woocommerce = 'disallowed by robots.txt';
    else if (Array.isArray(woo)) {
      out.kind = 'woocommerce';
      out.sample = woo.length;
      out.wineShare = woo.length ? +((woo as Array<{ name: string }>).filter((p) => parseTitle(p.name).isWine).length / woo.length).toFixed(2) : 0;
      out.examples = (woo as Array<{ name: string }>).slice(0, 3).map((p) => p.name);
    }
  }
  if (out.kind) out.tos = (await tos(origin)) ?? 'not found';
  console.log(JSON.stringify(out));
}

const domains = process.argv.slice(2);
for (let i = 0; i < domains.length; i += 6) await Promise.all(domains.slice(i, i + 6).map(probe));
