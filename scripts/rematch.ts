/**
 * Re-run matching for listings selected by a SQL condition, after a matcher
 * fix. Each listing's observations are dropped and re-recorded from its
 * latest offer; crawl-created wines left with no listings are deleted.
 *
 *   tsx scripts/rematch.ts "l.title ~* '\\mclos\\M'"
 *   tsx scripts/rematch.ts --changed-only "l.match_status = 'auto'"
 *   tsx scripts/rematch.ts --generic-wines "true"   # listings on wines named only by grape/place
 *
 * --changed-only first re-scores each selected listing against the current
 * catalog and only re-matches those whose current wine is no longer the
 * confident match (cheap way to apply a matcher fix to the whole crawl).
 */
import { createPool } from '../src/db/pool.js';
import { ingestOffer, isGenericTitle } from '../src/prices/ingest.js';
import { parseTitle } from '../src/lib/listing.js';
import { normalize } from '../src/lib/normalize.js';
import { scoreCandidates, THRESHOLDS } from '../src/match/score.js';
import { aggregateWines, staleWineIds } from '../src/prices/aggregate.js';

const changedOnly = process.argv.includes('--changed-only');
const genericWines = process.argv.includes('--generic-wines');
const where = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!where) {
  console.error('usage: tsx scripts/rematch.ts "<SQL condition on listings l>"');
  process.exit(1);
}
const db = createPool();
const { rows: selected } = await db.query(
  `SELECT l.*, m.name AS merchant_name FROM listings l JOIN merchants m USING (merchant_id)
    WHERE l.last_price_cents IS NOT NULL AND (${where})`
);
let rows = selected;
if (genericWines) {
  const { rows: w } = await db.query('SELECT wine_id, display_name FROM wines');
  const generic = new Set(w.filter((x) => isGenericTitle(x.display_name)).map((x) => x.wine_id));
  rows = rows.filter((l) => generic.has(l.wine_id));
}
if (changedOnly) {
  // Score each listing against its current wine only. Below the auto
  // threshold means the fixed matcher would no longer attach it. (Ties with
  // a duplicate wine don't count - re-matching those would just fragment.)
  const { rows: wines } = await db.query(
    `SELECT w.*, COALESCE((SELECT array_agg(alias_norm) FROM wine_aliases a WHERE a.wine_id = w.wine_id), '{}') AS aliases FROM wines w`
  );
  const byId = new Map(wines.map((w) => [w.wine_id, w]));
  const pool = rows;
  rows = [];
  for (const l of pool) {
    const wine = byId.get(l.wine_id);
    if (!wine) continue;
    const brandOk = l.brand && ` ${normalize(l.title)} `.includes(` ${normalize(l.brand)} `);
    const [scored] = scoreCandidates({ text: parseTitle(l.title).rest, producer: brandOk ? l.brand : undefined }, [wine]);
    if ((scored?.score ?? 0) < THRESHOLDS.auto) rows.push(l);
  }
}
console.log(`re-matching ${rows.length} of ${selected.length} listings`);
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
