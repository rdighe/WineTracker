/**
 * Find and merge duplicate catalog wines (the same wine created twice because
 * two shops titled it differently).
 *
 *   tsx scripts/duplicates.ts export [out.jsonl]   # likely pairs, for review
 *   tsx scripts/duplicates.ts apply decisions.jsonl
 *
 * Export lists, for every crawl/llm-created wine, the closest other wine when
 * its score is in the "plausible but not certain" band. Review each line and
 * write {"from": id, "to": id} for pairs that are the same wine (to = the
 * entry to keep). apply merges them and re-aggregates prices.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPool, withTransaction } from '../src/db/pool.js';
import { mergeWines } from '../src/catalog/wines.js';
import { matchWine } from '../src/match/matcher.js';
import { aggregateWines } from '../src/prices/aggregate.js';

const [mode, file] = process.argv.slice(2);
const db = createPool();

if (mode === 'export') {
  const out = file ?? 'data/review/duplicates.jsonl';
  const { rows } = await db.query(
    `SELECT w.wine_id, w.display_name, w.producer, COUNT(l.listing_id)::int AS listings
       FROM wines w LEFT JOIN listings l USING (wine_id)
      WHERE w.source IN ('crawl', 'llm') GROUP BY w.wine_id ORDER BY w.wine_id`
  );
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const w of rows) {
    const r = await matchWine(db, { text: w.display_name, producer: w.producer || undefined }, { excludeWineId: w.wine_id });
    const top = r.candidates[0];
    if (!top || top.score < 0.7) continue;
    const key = [w.wine_id, top.wine.wine_id].sort().join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(JSON.stringify({ a: w.wine_id, aName: w.display_name, b: top.wine.wine_id, bName: top.wine.display_name, score: Number(top.score.toFixed(3)) }));
  }
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`${lines.length} candidate pairs from ${rows.length} wines -> ${out}`);
} else if (mode === 'apply' && file) {
  const decisions = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { from: number; to: number });
  const touched = new Set<number>();
  for (const d of decisions) {
    await withTransaction(db, (c) => mergeWines(c, d.from, d.to));
    touched.add(d.to);
  }
  await aggregateWines(db, [...touched]);
  console.log(`merged ${decisions.length} wines`);
} else {
  console.error('usage: tsx scripts/duplicates.ts export [out.jsonl] | apply decisions.jsonl');
  process.exitCode = 1;
}
await db.end();
