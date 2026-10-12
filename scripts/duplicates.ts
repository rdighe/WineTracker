/**
 * Find and merge duplicate catalog wines (the same wine created twice because
 * two shops titled it differently).
 *
 *   tsx scripts/duplicates.ts export [out.jsonl]   # likely pairs, for review
 *   tsx scripts/duplicates.ts apply decisions.jsonl
 *   tsx scripts/duplicates.ts auto-merge [log.jsonl]  # merge pairs the matcher is sure about
 *   tsx scripts/duplicates.ts auto-merge --dry-run [log.jsonl]  # only log what it would merge
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [mode, file] = args.filter((a) => a !== '--dry-run');
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
} else if (mode === 'auto-merge') {
  // A crawl/llm wine whose own name auto-matches another wine (complete
  // two-way agreement, clear margin) is that wine under another shop's title.
  // Merge into the wine with more listings (ties: the older one).
  const log = file ?? 'data/review/auto-merged.jsonl';
  const { rows } = await db.query(
    `SELECT w.wine_id, w.display_name, w.producer FROM wines w WHERE w.source IN ('crawl', 'llm') ORDER BY w.wine_id`
  );
  const gone = new Set<number>();
  const touched = new Set<number>();
  const lines: string[] = [];
  for (const w of rows) {
    if (gone.has(w.wine_id)) continue;
    const r = await matchWine(db, { text: w.display_name, producer: w.producer || undefined }, { excludeWineId: w.wine_id });
    if (r.outcome !== 'auto') continue;
    const other = r.candidates[0]!.wine;
    const counts = await db.query(
      `SELECT wine_id, (SELECT COUNT(*) FROM listings l WHERE l.wine_id = w.wine_id)::int AS n FROM wines w WHERE wine_id = ANY($1)`,
      [[w.wine_id, other.wine_id]]
    );
    const n = new Map(counts.rows.map((x) => [x.wine_id, x.n]));
    const [from, to] = (n.get(w.wine_id) ?? 0) > (n.get(other.wine_id) ?? 0) ? [other.wine_id, w.wine_id] : [w.wine_id, other.wine_id];
    if (!dryRun) await withTransaction(db, (c) => mergeWines(c, from, to));
    gone.add(from);
    touched.add(to);
    lines.push(JSON.stringify({ from, fromName: from === w.wine_id ? w.display_name : other.display_name, to, toName: to === w.wine_id ? w.display_name : other.display_name, score: Number(r.candidates[0]!.score.toFixed(3)) }));
  }
  writeFileSync(log, lines.join('\n') + '\n');
  for (const id of gone) touched.delete(id);
  const ids = dryRun ? [] : [...touched];
  for (let i = 0; i < ids.length; i += 500) await aggregateWines(db, ids.slice(i, i + 500));
  console.log(`${dryRun ? 'would merge' : 'auto-merged'} ${lines.length} duplicate wines -> ${log}`);
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
