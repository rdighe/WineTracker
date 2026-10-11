/** Recompute market prices for wines whose observations changed since the last run. */
import { createPool } from '../src/db/pool.js';
import { aggregateWines, staleWineIds } from '../src/prices/aggregate.js';

const db = createPool();
const ids = await staleWineIds(db);
for (let i = 0; i < ids.length; i += 500) await aggregateWines(db, ids.slice(i, i + 500));
console.log(`aggregated ${ids.length} wines`);
await db.end();
