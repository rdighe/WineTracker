/**
 * Re-run matching for listings selected by a SQL condition, after a matcher
 * fix. Each listing's observations are dropped and re-recorded from its
 * latest offer; crawl-created wines left with no listings are deleted.
 *
 *   tsx scripts/rematch.ts "l.title ~* '\\mclos\\M'"
 */
import { createPool } from '../src/db/pool.js';
import { ingestOffer } from '../src/prices/ingest.js';
import { aggregateWines, staleWineIds } from '../src/prices/aggregate.js';

const where = process.argv[2];
if (!where) {
  console.error('usage: tsx scripts/rematch.ts "<SQL condition on listings l>"');
  process.exit(1);
}
const db = createPool();
const { rows } = await db.query(
  `SELECT l.*, m.name AS merchant_name FROM listings l JOIN merchants m USING (merchant_id)
    WHERE l.last_price_cents IS NOT NULL AND (${where})`
);
console.log(`re-matching ${rows.length} listings`);
const oldWines = new Set<number>();
let changed = 0;
for (const l of rows) {
  if (l.wine_id) oldWines.add(l.wine_id);
  await db.query('DELETE FROM price_observations WHERE listing_id = $1', [l.listing_id]);
  await db.query(`UPDATE listings SET wine_id = NULL, match_status = 'unmatched' WHERE listing_id = $1`, [l.listing_id]);
  const r = await ingestOffer(
    db,
    {
      merchantId: l.merchant_id,
      merchantName: l.merchant_name,
      url: l.url,
      offer: { title: l.title, brand: l.brand, sku: l.sku, gtin: l.gtin, priceCents: l.last_price_cents, currency: l.last_currency ?? 'USD', inStock: l.last_in_stock, attributes: l.attributes, via: 'jsonld' },
    },
    { createWines: true }
  );
  if (r.wineId !== l.wine_id) changed++;
}
const { rowCount } = await db.query(
  `DELETE FROM wines w WHERE w.wine_id = ANY($1) AND w.source = 'crawl'
     AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.wine_id = w.wine_id)
     AND NOT EXISTS (SELECT 1 FROM price_observations o WHERE o.wine_id = w.wine_id)
     AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.chosen_wine_id = w.wine_id)`,
  [[...oldWines]]
);
await db.query(`DELETE FROM wine_prices WHERE wine_id = ANY($1)`, [[...oldWines]]);
const stale = [...new Set([...(await staleWineIds(db)), ...oldWines])];
for (let i = 0; i < stale.length; i += 500) await aggregateWines(db, stale.slice(i, i + 500));
console.log(`${changed} listings changed wine; removed ${rowCount} orphaned crawl wines; re-aggregated ${stale.length} wines`);
await db.end();
