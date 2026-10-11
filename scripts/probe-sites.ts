/**
 * Probe candidate retailer sites: does robots.txt allow our crawler, what
 * sitemaps exist, and does a sample product page publish structured prices?
 * Usage: tsx scripts/probe-sites.ts domain1 domain2 ...
 */
import { config } from '../src/config.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { parseSitemapXml } from '../src/prices/sitemap.js';
import { gunzipSync } from 'node:zlib';

const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 1500, timeoutMs: 15000, blockAfter: 3 });

async function probe(domain: string) {
  const origin = `https://${domain}`;
  const out: Record<string, unknown> = { domain };
  try {
    out.rootAllowed = await fetcher.isAllowed(`${origin}/`);
    const sitemaps = await fetcher.sitemaps(origin);
    out.sitemaps = sitemaps.slice(0, 5);
    const first = sitemaps[0] ?? `${origin}/sitemap.xml`;
    const r = await fetcher.get(first, 'application/xml,*/*');
    out.sitemapStatus = r.status;
    if (r.status === 200) {
      const gz = r.raw[0] === 0x1f && r.raw[1] === 0x8b;
      const p = parseSitemapXml(gz ? gunzipSync(r.raw).toString('utf8') : r.body);
      out.children = p.sitemaps.slice(0, 8);
      out.sampleUrls = p.urls.slice(0, 3);
    }
  } catch (err) {
    out.error = (err as Error).message;
  }
  console.log(JSON.stringify(out));
}

const domains = process.argv.slice(2);
await Promise.all(domains.map(probe));
