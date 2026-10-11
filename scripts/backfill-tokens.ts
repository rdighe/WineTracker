/** Fill wines.tokens for rows created before migration 003. Safe to re-run. */
import { createPool } from '../src/db/pool.js';
import { wineTokens } from '../src/catalog/wines.js';

const db = createPool();
const { rows } = await db.query(`SELECT wine_id, producer, name, display_name FROM wines WHERE tokens = '{}'`);
for (const w of rows) await db.query('UPDATE wines SET tokens = $2 WHERE wine_id = $1', [w.wine_id, wineTokens(w)]);
console.log(`backfilled ${rows.length} wines`);
await db.end();
