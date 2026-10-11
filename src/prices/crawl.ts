/**
 * Crawl retailers (see sites.ts): catalog feeds (Shopify, WooCommerce) and
 * sitemap + product-page sites. Used by scripts/crawl.ts and the worker.
 *
 * Sitemap crawls are resumable (crawl_pages). Pages fetched more than
 * RECRAWL_DAYS ago are queued again, and sitemaps are re-read for new
 * products once the queue is empty and the last discovery is that old.
 */
import type pg from 'pg';
import { aggregateWines, staleWineIds } from './aggregate.js';
import { extractOffer, type ExtractedOffer } from './extract.js';
import { DisallowedError, HostBlockedError, type PoliteFetcher } from './fetcher.js';
import { ensureMerchant, ingestOffer, type IngestStatus } from './ingest.js';
import { offersFromProduct, shopifyProducts } from './shopify.js';
import { discoverProductUrls } from './sitemap.js';
import type { SiteConfig } from './sites.js';
import { offerFromWoo, wooProducts } from './woocommerce.js';

export const RECRAWL_DAYS = 7;

export interface CrawlOptions {
  maxPages: number;
  createWines: boolean;
  startPage?: number;
  log?: (msg: string) => void;
}

export type Counts = Record<IngestStatus | 'created' | 'no_offer' | 'error', number>;
const newCounts = (): Counts => ({ priced: 0, review: 0, unmatched: 0, not_wine: 0, skipped_currency: 0, created: 0, no_offer: 0, error: 0 });
export const fmtCounts = (c: Counts) => Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');

export async function crawlSites(db: pg.Pool, fetcher: PoliteFetcher, sites: SiteConfig[], opts: CrawlOptions): Promise<void> {
  const out = opts.log ?? console.log;
  const log = (site: SiteConfig, msg: string) => out(`${new Date().toISOString()} [${site.domain}] ${msg}`);
  const { maxPages, createWines } = opts;
  const startPage = opts.startPage ?? 1;

  // Ingestion is serialized so two sites can't create the same new wine twice.
  let lock: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = lock.then(fn, fn);
    lock = p.catch(() => undefined);
    return p;
  }

  /** Catalog feeds (Shopify products.json, WooCommerce Store API): many products per request. */
  async function* feedOffers(site: SiteConfig): AsyncGenerator<Array<{ url: string; offer: ExtractedOffer }>> {
    const origin = `https://${site.domain}`;
    if (site.kind === 'shopify') {
      for await (const products of shopifyProducts(fetcher, origin, 400, startPage)) yield products.flatMap((p) => offersFromProduct(p, origin));
    } else {
      for await (const products of wooProducts(fetcher, origin, 2000, startPage)) yield products.map(offerFromWoo).filter((o) => o !== null);
    }
  }

  async function crawlFeed(site: SiteConfig, merchantId: number): Promise<Counts> {
    const c = newCounts();
    let page = startPage - 1;
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
      if (page % 5 === 0) log(site, `feed page ${page}: ${fmtCounts(c)}`);
    }
    return c;
  }

  async function crawlSitemapSite(site: SiteConfig, merchantId: number): Promise<Counts> {
    const c = newCounts();
    // Pages crawled more than RECRAWL_DAYS ago go back in the queue.
    const requeued = await db.query(
      `UPDATE crawl_pages SET status = 'queued', queued_at = NOW()
        WHERE merchant_id = $1 AND status IN ('done', 'error') AND fetched_at < NOW() - make_interval(days => $2)`,
      [merchantId, RECRAWL_DAYS]
    );
    if (requeued.rowCount) log(site, `re-queued ${requeued.rowCount} pages last fetched over ${RECRAWL_DAYS} days ago`);
    // (Re)read sitemaps when nothing is queued and the last discovery is old (or never happened).
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM crawl_pages WHERE merchant_id = $1 AND status = 'queued') AS queued, sitemaps_read_at AS last
         FROM merchants WHERE merchant_id = $1`,
      [merchantId]
    );
    const last: Date | null = rows[0].last;
    if (rows[0].queued === 0 && (!last || Date.now() - last.getTime() > RECRAWL_DAYS * 86400000)) {
      const roots = site.sitemaps ?? (await fetcher.sitemaps(`https://${site.domain}`));
      const urls = await discoverProductUrls(fetcher, roots, {
        productPattern: site.productPattern ?? /./,
        childPattern: site.childPattern,
        log: (m) => log(site, m),
      });
      let added = 0;
      for (let i = 0; i < urls.length; i += 1000) {
        const r = await db.query(
          `INSERT INTO crawl_pages (url, merchant_id) SELECT unnest($1::text[]), $2 ON CONFLICT DO NOTHING`,
          [urls.slice(i, i + 1000), merchantId]
        );
        added += r.rowCount ?? 0;
      }
      await db.query('UPDATE merchants SET sitemaps_read_at = NOW() WHERE merchant_id = $1', [merchantId]);
      log(site, `sitemaps list ${urls.length} product pages, ${added} new`);
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
        if (done % 100 === 0) log(site, `${done} pages: ${fmtCounts(c)}`);
      }
    }
    return c;
  }

  async function crawlSite(site: SiteConfig) {
    const merchantId = await ensureMerchant(db, site.domain, site.name);
    const started = Date.now();
    try {
      const c = site.kind !== 'sitemap' ? await crawlFeed(site, merchantId) : await crawlSitemapSite(site, merchantId);
      log(site, `finished in ${Math.round((Date.now() - started) / 60000)} min: ${fmtCounts(c)}`);
    } catch (err) {
      log(site, `failed: ${(err as Error).message}`);
    }
  }

  await Promise.all(sites.map(crawlSite));
  const stale = await staleWineIds(db);
  out(`aggregating prices for ${stale.length} wines...`);
  for (let i = 0; i < stale.length; i += 500) await aggregateWines(db, stale.slice(i, i + 500));
}
