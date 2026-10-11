/**
 * Bulk price crawl over the retailers in src/prices/sites.ts.
 *
 *   npm run crawl -- [--site www.zachys.com ...] [--max-pages 4000]
 *                    [--exclude-tos-prohibited] [--no-create]
 *
 * Sites run in parallel; requests to any one site are serialized and spaced
 * by the robots.txt Crawl-delay (min 2s). Sitemap crawls are resumable:
 * progress lives in crawl_pages, so re-running continues where it stopped.
 */
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { crawlSites } from '../src/prices/crawl.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { SITES } from '../src/prices/sites.js';

const { values } = parseArgs({
  options: {
    site: { type: 'string', multiple: true },
    'max-pages': { type: 'string', default: '4000' },
    'exclude-tos-prohibited': { type: 'boolean', default: false },
    'no-create': { type: 'boolean', default: false },
    // Resume a feed crawl (Shopify/WooCommerce) from this page.
    'start-page': { type: 'string', default: '1' },
  },
});
const sites = SITES.filter(
  (s) => (!values.site?.length || values.site.includes(s.domain)) && !(values['exclude-tos-prohibited'] && s.tos === 'prohibits_scraping')
);
const db = createPool();
const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 2000, timeoutMs: 30000 });
console.log(`crawling ${sites.length} site(s): ${sites.map((s) => s.domain).join(', ')}`);
await crawlSites(db, fetcher, sites, {
  maxPages: Number(values['max-pages']),
  createWines: !values['no-create'],
  startPage: Number(values['start-page']),
});
console.log('done');
await db.end();
