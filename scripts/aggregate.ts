/**
 * Recompute market prices for wines whose observations changed since the last run.
 *
 *   tsx scripts/aggregate.ts                 # stale wines only
 *   tsx scripts/aggregate.ts --out-of-stock  # also every wine with out-of-stock offers in the last year
 *                                            # (after the out-of-stock fallback rule changed)
 *
 * --out-of-stock skips wines recomputed in the last day, so an interrupted run
 * can simply be started again.
 */
import { createPool } from '../src/db/pool.js';
import { aggregateWines, staleWineIds } from '../src/prices/aggregate.js';

const db = createPool();
const ids = new Set(await staleWineIds(db));
if (process.argv.includes('--out-of-stock')) {
  const { rows } = await db.query(
    `SELECT w.wine_id FROM wines w
      WHERE (w.prices_computed_at IS NULL OR w.prices_computed_at < NOW() - INTERVAL '1 day')
        AND EXISTS (SELECT 1 FROM price_observations o
                     WHERE o.wine_id = w.wine_id AND o.in_stock = FALSE AND o.observed_at > NOW() - INTERVAL '365 days')
      ORDER BY w.wine_id`
  );
  for (const r of rows) ids.add(r.wine_id);
}
const list = [...ids];
for (let i = 0; i < list.length; i += 500) {
  await aggregateWines(db, list.slice(i, i + 500));
  if (list.length > 500) console.log(`${Math.min(i + 500, list.length)} / ${list.length}`);
}
console.log(`aggregated ${list.length} wines`);
await db.end();
