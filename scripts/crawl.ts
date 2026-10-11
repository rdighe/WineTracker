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
import { aggregateWines, staleWineIds } from '../src/prices/aggregate.js';
import { extractOffer } from '../src/prices/extract.js';
import { DisallowedError, HostBlockedError, PoliteFetcher } from '../src/prices/fetcher.js';
import { ensureMerchant, ingestOffer, type IngestStatus } from '../src/prices/ingest.js';
import { offersFromProduct, shopifyProducts } from '../src/prices/shopify.js';
import { offerFromWoo, wooProducts } from '../src/prices/woocommerce.js';
import type { ExtractedOffer } from '../src/prices/extract.js';
import { discoverProductUrls } from '../src/prices/sitemap.js';
import { SITES, type SiteConfig } from '../src/prices/sites.js';

const { values } = parseArgs({
  options: {
    site: { type: 'string', multiple: true },
    'max-pages': { type: 'string', default: '4000' },
    'exclude-tos-prohibited': { type: 'boolean', default: false },
    'no-create': { type: 'boolean', default: false },
  },
});
const maxPages = Number(values['max-pages']);
const createWines = !values['no-create'];
const sites = SITES.filter(
  (s) => (!values.site?.length || values.site.includes(s.domain)) && !(values['exclude-tos-prohibited'] && s.tos === 'prohibits_scraping')
);

const db = createPool();
const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 2000, timeoutMs: 30000 });

// Ingestion is serialized so two sites can't create the same new wine twice.
let lock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = lock.then(fn, fn);
  lock = p.catch(() => undefined);
  return p;
}

const log = (site: SiteConfig, msg: string) => console.log(`${new Date().toISOString()} [${site.domain}] ${msg}`);

type Counts = Record<IngestStatus | 'created' | 'no_offer' | 'error', number>;
const newCounts = (): Counts => ({ priced: 0, review: 0, unmatched: 0, not_wine: 0, skipped_currency: 0, created: 0, no_offer: 0, error: 0 });
const fmt = (c: Counts) => Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');

/** Catalog feeds (Shopify products.json, WooCommerce Store API): many products per request. */
async function* feedOffers(site: SiteConfig): AsyncGenerator<Array<{ url: string; offer: ExtractedOffer }>> {
  const origin = `https://${site.domain}`;
  if (site.kind === 'shopify') {
    for await (const products of shopifyProducts(fetcher, origin)) yield products.flatMap((p) => offersFromProduct(p, origin));
  } else {
    for await (const products of wooProducts(fetcher, origin)) yield products.map(offerFromWoo).filter((o) => o !== null);
  }
}

async function crawlFeed(site: SiteConfig, merchantId: number): Promise<Counts> {
  const c = newCounts();
  let page = 0;
  for await (const offers of feedOffers(site)) {
    page++;
    {
      for (const { url, offer } of offers) {
        try {
          const r = await serial(() => ingestOffer(db, { merchantId, merchantName: site.name, url, offer }, { createWines }));
          c[r.status]++;
          if (r.created) c.created++;
        } catch (err) {
          c.error++;
          if (c.error < 5) log(site, `ingest ${url}: ${(err as Error).message}`);
        }
      }
    }
    if (page % 5 === 0) log(site, `feed page ${page}: ${fmt(c)}`);
  }
  return c;
}

async function crawlSitemapSite(site: SiteConfig, merchantId: number): Promise<Counts> {
  const c = newCounts();
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM crawl_pages WHERE merchant_id = $1`, [merchantId]);
  if (rows[0].n === 0) {
    const roots = site.sitemaps ?? (await fetcher.sitemaps(`https://${site.domain}`));
    const urls = await discoverProductUrls(fetcher, roots, {
      productPattern: site.productPattern ?? /./,
      childPattern: site.childPattern,
      log: (m) => log(site, m),
    });
    for (let i = 0; i < urls.length; i += 1000) {
      await db.query(
        `INSERT INTO crawl_pages (url, merchant_id) SELECT unnest($1::text[]), $2 ON CONFLICT DO NOTHING`,
        [urls.slice(i, i + 1000), merchantId]
      );
    }
    log(site, `queued ${urls.length} product pages`);
  }
  for (let done = 0; done < maxPages; ) {
    const { rows: batch } = await db.query(
      `SELECT url FROM crawl_pages WHERE merchant_id = $1 AND status = 'queued' ORDER BY queued_at, url LIMIT 50`,
      [merchantId]
    );
    if (!batch.length) break;
    for (const { url } of batch) {
      if (done >= maxPages) break;
      done++;
      let status = 'done';
      let http: number | null = null;
      let found = false;
      let error: string | null = null;
      try {
        const page = await fetcher.get(url);
        http = page.status;
        const offer = page.status === 200 ? extractOffer(page.body) : null;
        if (offer) {
          found = true;
          const r = await serial(() => ingestOffer(db, { merchantId, merchantName: site.name, url, offer }, { createWines }));
          c[r.status]++;
          if (r.created) c.created++;
        } else {
          c.no_offer++;
        }
      } catch (err) {
        if (err instanceof HostBlockedError) {
          log(site, `stopping: ${err.message}`);
          return c;
        }
        status = err instanceof DisallowedError ? 'disallowed' : 'error';
        error = (err as Error).message.slice(0, 300);
        c.error++;
      }
      await db.query(
        `UPDATE crawl_pages SET status = $2, http_status = $3, found_product = $4, error = $5, fetched_at = NOW() WHERE url = $1`,
        [url, status, http, found, error]
      );
      if (done % 100 === 0) log(site, `${done} pages: ${fmt(c)}`);
    }
  }
  return c;
}

async function crawlSite(site: SiteConfig) {
  const merchantId = await ensureMerchant(db, site.domain, site.name);
  const started = Date.now();
  try {
    const c = site.kind !== 'sitemap' ? await crawlFeed(site, merchantId) : await crawlSitemapSite(site, merchantId);
    log(site, `finished in ${Math.round((Date.now() - started) / 60000)} min: ${fmt(c)}`);
  } catch (err) {
    log(site, `failed: ${(err as Error).message}`);
  }
}

console.log(`crawling ${sites.length} site(s): ${sites.map((s) => s.domain).join(', ')} (createWines=${createWines}, maxPages=${maxPages})`);
await Promise.all(sites.map(crawlSite));
const stale = await staleWineIds(db);
console.log(`aggregating prices for ${stale.length} wines...`);
for (let i = 0; i < stale.length; i += 500) await aggregateWines(db, stale.slice(i, i + 500));
console.log('done');
await db.end();
