/**
 * Background jobs (run as a separate process: `npm run worker`).
 *
 *   feeds     daily     Shopify/WooCommerce catalog feeds (cheap: ~250 products per request)
 *   pages     6-hourly  sitemap sites, up to PAGES_PER_RUN product pages per run (resumable)
 *   watched   daily     on-demand-style refresh (incl. LLM web search) of wines users saved or
 *                       tasted recently, stalest first, at most REFRESH_PER_NIGHT
 *
 * `npm run worker -- --once feeds|pages|watched` runs one job and exits.
 * A job is skipped if its previous run is still going.
 */
import cron from 'node-cron';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { createProvider } from './llm/index.js';
import { crawlSites } from './prices/crawl.js';
import { PoliteFetcher } from './prices/fetcher.js';
import { refreshPrices } from './prices/refresh.js';
import { SITES } from './prices/sites.js';

const PAGES_PER_RUN = Number(process.env.PAGES_PER_RUN ?? 2000);
const REFRESH_PER_NIGHT = Number(process.env.REFRESH_PER_NIGHT ?? 100);
const EXCLUDE_TOS_PROHIBITED = process.env.EXCLUDE_TOS_PROHIBITED === 'true';

const db = createPool();
const provider = createProvider();
const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 2000, timeoutMs: 30000 });
const sites = SITES.filter((s) => !(EXCLUDE_TOS_PROHIBITED && s.tos === 'prohibits_scraping'));
const log = (job: string, msg: string) => console.log(`${new Date().toISOString()} [${job}] ${msg}`);

const jobs: Record<string, () => Promise<void>> = {
  async feeds() {
    await crawlSites(db, fetcher, sites.filter((s) => s.kind !== 'sitemap'), { maxPages: 1_000_000, createWines: true, log: (m) => log('feeds', m) });
  },
  async pages() {
    await crawlSites(db, fetcher, sites.filter((s) => s.kind === 'sitemap'), { maxPages: PAGES_PER_RUN, createWines: true, log: (m) => log('pages', m) });
  },
  async watched() {
    const { rows } = await db.query(
      `WITH watched AS (
         SELECT wine_id, NULLIF(vintage_key, '*') AS vintage_key FROM saved_wines
         UNION
         SELECT wine_id, vintage_key FROM tastings WHERE tasted_on > CURRENT_DATE - 90
       )
       SELECT w.wine_id, w.vintage_key,
              (SELECT MAX(observed_at) FROM price_observations o WHERE o.wine_id = w.wine_id AND o.source_type <> 'user') AS last_seen
         FROM watched w
        ORDER BY last_seen NULLS FIRST
        LIMIT $1`,
      [REFRESH_PER_NIGHT]
    );
    let done = 0;
    for (const r of rows) {
      try {
        const out = await refreshPrices(db, fetcher, provider, r.wine_id, r.vintage_key);
        if (out.status === 'refreshed') done++;
      } catch (err) {
        log('watched', `wine ${r.wine_id}: ${(err as Error).message}`);
      }
    }
    log('watched', `refreshed ${done} of ${rows.length} watched wines`);
  },
};

const running = new Set<string>();
async function run(name: string) {
  if (running.has(name)) return log(name, 'previous run still going; skipped');
  running.add(name);
  const t = Date.now();
  try {
    await jobs[name]!();
    log(name, `finished in ${Math.round((Date.now() - t) / 1000)}s`);
  } catch (err) {
    log(name, `failed: ${(err as Error).stack ?? err}`);
  } finally {
    running.delete(name);
  }
}

const onceIdx = process.argv.indexOf('--once');
if (onceIdx >= 0) {
  const name = process.argv[onceIdx + 1] ?? '';
  if (!jobs[name]) {
    console.error(`unknown job "${name}"; one of: ${Object.keys(jobs).join(', ')}`);
    process.exit(1);
  }
  await run(name);
  await db.end();
} else {
  // Off-the-hour minutes so runs don't pile onto :00 with everyone else's crons.
  cron.schedule('17 9 * * *', () => run('feeds'), { timezone: 'UTC' });
  cron.schedule('47 */6 * * *', () => run('pages'), { timezone: 'UTC' });
  cron.schedule('23 11 * * *', () => run('watched'), { timezone: 'UTC' });
  console.log(`worker started (LLM provider: ${provider.name}); jobs: feeds daily 09:17 UTC, pages every 6h, watched daily 11:23 UTC`);
}
