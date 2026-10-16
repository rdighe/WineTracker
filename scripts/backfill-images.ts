/**
 * Reference photos for an existing database: listings crawled before images
 * were recorded get their shop image from the catalog feeds (no re-matching,
 * no prices), then wines on people's lists get a photo picked.
 *
 *   tsx scripts/backfill-images.ts                 # feeds, then photos
 *   tsx scripts/backfill-images.ts --photos-only   # only pick photos from images already recorded
 *   tsx scripts/backfill-images.ts --exclude-tos-prohibited
 *   tsx scripts/backfill-images.ts --site bottlebarn.com   # one shop's feed
 *
 * Sitemap shops (product pages) pick up images as the worker re-crawls their pages.
 */
import { findWineImage } from '../src/catalog/images.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { offersFromProduct, shopifyProducts } from '../src/prices/shopify.js';
import { SITES } from '../src/prices/sites.js';
import { offerFromWoo, wooProducts } from '../src/prices/woocommerce.js';

const args = process.argv.slice(2);
const db = createPool();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

if (!args.includes('--photos-only')) {
  const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 2000, timeoutMs: 30000 });
  const only = args.flatMap((a, i) => (a === '--site' && args[i + 1] ? [args[i + 1]!] : []));
  const sites = SITES.filter((s) => s.kind !== 'sitemap' && (!only.length || only.includes(s.domain)) && !(args.includes('--exclude-tos-prohibited') && s.tos === 'prohibits_scraping'));
  for (const site of sites) {
    const origin = `https://${site.domain}`;
    let updated = 0;
    try {
      const pages = site.kind === 'shopify'
        ? (async function* () { for await (const ps of shopifyProducts(fetcher, origin)) yield ps.flatMap((p) => offersFromProduct(p, origin)); })()
        : (async function* () { for await (const ps of wooProducts(fetcher, origin)) yield ps.map(offerFromWoo).filter((o) => o !== null); })();
      for await (const offers of pages) {
        for (const { url, offer } of offers) {
          if (!offer.imageUrl) continue;
          const r = await db.query('UPDATE listings SET image_url = $2 WHERE url = $1 AND image_url IS DISTINCT FROM $2', [url, offer.imageUrl]);
          updated += r.rowCount ?? 0;
        }
      }
      log(`[${site.domain}] ${updated} listing images`);
    } catch (e) {
      log(`[${site.domain}] stopped: ${(e as Error).message}`);
    }
  }
}

// Photos for wines people have logged or saved (others are picked when their page is opened).
const { rows } = await db.query(
  `SELECT DISTINCT ON (w.wine_id) w.wine_id, t.vintage_key FROM wines w
     LEFT JOIN tastings t ON t.wine_id = w.wine_id
    WHERE w.image_url IS NULL AND (t.tasting_id IS NOT NULL OR EXISTS (SELECT 1 FROM saved_wines s WHERE s.wine_id = w.wine_id))
    ORDER BY w.wine_id, t.tasted_on DESC NULLS LAST`
);
let found = 0;
for (const r of rows) if (await findWineImage(db, r.wine_id, r.vintage_key)) found++;
log(`photos: ${found} of ${rows.length} wines`);
await db.end();
