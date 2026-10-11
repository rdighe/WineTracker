/**
 * Product URL discovery from sitemaps (robots.txt "Sitemap:" lines, or
 * configured URLs). Handles sitemap indexes and gzipped sitemaps.
 */
import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import type { PoliteFetcher } from './fetcher.js';

const parser = new XMLParser({ ignoreAttributes: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export interface SitemapOptions {
  /** Keep only URLs matching this (product pages). */
  productPattern: RegExp;
  /** Only descend into child sitemaps matching this, when set. */
  childPattern?: RegExp;
  maxUrls?: number;
  maxSitemaps?: number;
  log?: (msg: string) => void;
}

export function parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] } {
  const doc = parser.parse(xml);
  const sitemaps = arr(doc?.sitemapindex?.sitemap).map((s: { loc?: string }) => String(s.loc ?? '').trim()).filter(Boolean);
  const urls = arr(doc?.urlset?.url).map((u: { loc?: string }) => String(u.loc ?? '').trim()).filter(Boolean);
  return { sitemaps, urls };
}

export async function discoverProductUrls(fetcher: PoliteFetcher, roots: string[], opts: SitemapOptions): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? 100000;
  const maxSitemaps = opts.maxSitemaps ?? 200;
  const seen = new Set<string>();
  const found = new Set<string>();
  const queue = [...roots];
  while (queue.length && seen.size < maxSitemaps && found.size < maxUrls) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml: string;
    try {
      const r = await fetcher.get(sm, 'application/xml,text/xml,*/*');
      if (r.status !== 200) {
        opts.log?.(`sitemap ${sm}: HTTP ${r.status}`);
        continue;
      }
      const gz = r.raw.length > 2 && r.raw[0] === 0x1f && r.raw[1] === 0x8b;
      xml = gz ? gunzipSync(r.raw).toString('utf8') : r.body;
    } catch (err) {
      opts.log?.(`sitemap ${sm}: ${(err as Error).message}`);
      continue;
    }
    const { sitemaps, urls } = parseSitemapXml(xml);
    for (const child of sitemaps) if (!opts.childPattern || opts.childPattern.test(child)) queue.push(child);
    for (const u of urls) {
      if (opts.productPattern.test(u)) found.add(u);
      if (found.size >= maxUrls) break;
    }
    opts.log?.(`sitemap ${sm}: ${urls.length} urls, ${sitemaps.length} child sitemaps (products so far: ${found.size})`);
  }
  return [...found];
}
