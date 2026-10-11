/**
 * Fill wines.tokens. By default only rows with no tokens (created before
 * migration 003); with --all, recompute every row (after changing
 * normalization rules such as the stopword list). Safe to re-run.
 */
import { createPool } from '../src/db/pool.js';
import { producerNorm, searchNorm, wineTokens } from '../src/catalog/wines.js';

const all = process.argv.includes('--all');
const db = createPool();
const { rows } = await db.query(
  `SELECT wine_id, producer, name, display_name, region, sub_region, grape, source FROM wines ${all ? '' : `WHERE tokens = '{}'`}`
);
for (let i = 0; i < rows.length; i += 1000) {
  const batch = rows.slice(i, i + 1000);
  await db.query(
    `UPDATE wines w SET tokens = string_to_array(v.toks, ' '), producer_norm = v.pn, search_norm = v.sn
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) AS v(id, pn, sn, toks)
      WHERE w.wine_id = v.id`,
    [batch.map((w) => w.wine_id), batch.map((w) => producerNorm(w.producer)), batch.map((w) => searchNorm(w)), batch.map((w) => wineTokens(w).join(' '))]
  );
}
console.log(`recomputed tokens for ${rows.length} wines`);
await db.end();
