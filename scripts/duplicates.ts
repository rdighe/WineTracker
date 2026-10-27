/**
 * Find and merge duplicate catalog wines (the same wine created twice because
 * two shops titled it differently).
 *
 *   tsx scripts/duplicates.ts export [out.jsonl]   # likely pairs, for review
 *   tsx scripts/duplicates.ts apply decisions.jsonl
 *   tsx scripts/duplicates.ts auto-merge [log.jsonl]  # merge pairs the matcher is sure about
 *   tsx scripts/duplicates.ts auto-merge --dry-run [log.jsonl]  # only log what it would merge
 *   tsx scripts/duplicates.ts twins [--dry-run] [log.jsonl]  # merge identical copies (src/catalog/twins.ts)
 *
 * Export lists, for every crawl/llm-created wine, the closest other wine when
 * its score is in the "plausible but not certain" band. Review each line and
 * write {"from": id, "to": id} for pairs that are the same wine (to = the
 * entry to keep). apply merges them and re-aggregates prices.
 */
import { mkdirSync, readFileSync, writeFileSync as writeFile } from 'node:fs';
import { dirname } from 'node:path';
import { createPool, withTransaction } from '../src/db/pool.js';
import { mergeWines } from '../src/catalog/wines.js';
import { matchWine } from '../src/match/matcher.js';
import { THRESHOLDS } from '../src/match/score.js';
import { normalize } from '../src/lib/normalize.js';
import { aggregateWines } from '../src/prices/aggregate.js';
import { mergeTwins } from '../src/catalog/twins.js';

/** Words that tell a cuvee's versions apart but are not identity tokens: "Roederer Brut" vs "Roederer Vintage Brut". */
function styleWords(title: string): string {
  const words = new Set(normalize(title).split(' '));
  return ['vintage', 'millesime', 'extra', 'nature', 'zero', 'rose', 'blanc', 'demi', 'sec', 'doux', 'late']
    .filter((w) => words.has(w)).join(' ');
}

/** Write a log/export, creating its folder (data/review/ is git-ignored, so absent on a fresh deploy). */
function writeFileSync(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFile(path, text);
}

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
  // Merging two catalog entries is stricter than matching a scan: no typo
  // tolerance (both spellings are real names), a producer on at least one
  // side, and the other wine's own producer + name must lead back to this one.
  // Merge into the catalog wine, or between shop-created wines into the one
  // with more listings (ties: the older one).
  const log = file ?? 'data/review/auto-merged.jsonl';
  const { rows } = await db.query(
    `SELECT w.wine_id, w.display_name, w.producer, w.name, w.source FROM wines w WHERE w.source IN ('crawl', 'llm') ORDER BY w.wine_id`
  );
  const gone = new Set<number>();
  const touched = new Set<number>();
  const lines: string[] = [];
  for (const w of rows) {
    if (gone.has(w.wine_id)) continue;
    const r = await matchWine(db, { text: w.display_name, producer: w.producer || undefined }, { excludeWineId: w.wine_id, exact: true });
    if (r.outcome !== 'auto') continue;
    const other = r.candidates[0]!.wine;
    if (gone.has(other.wine_id) || (!w.producer && !other.producer)) continue;
    if (styleWords(w.display_name) !== styleWords(other.display_name)) continue;
    // Catalog wines are asked by producer + name only: their display name adds the appellation.
    const backText = other.source === 'crawl' || other.source === 'llm' ? other.display_name : `${other.producer} ${other.name}`;
    const back = await matchWine(db, { text: backText, producer: other.producer || undefined }, { excludeWineId: other.wine_id, exact: true });
    const backHit = back.candidates.find((c) => c.wine.wine_id === w.wine_id);
    if (!backHit || backHit.score < THRESHOLDS.auto || back.candidates[0]!.score > backHit.score) continue;
    const counts = await db.query(
      `SELECT wine_id, (SELECT COUNT(*) FROM listings l WHERE l.wine_id = w.wine_id)::int AS n FROM wines w WHERE wine_id = ANY($1)`,
      [[w.wine_id, other.wine_id]]
    );
    const n = new Map(counts.rows.map((x) => [x.wine_id, x.n]));
    // Keep a catalog (LWIN/user) wine over a shop-created one: it carries the LWIN, region and colour.
    const otherIsCatalog = other.source !== 'crawl' && other.source !== 'llm';
    const [from, to] = !otherIsCatalog && (n.get(w.wine_id) ?? 0) > (n.get(other.wine_id) ?? 0) ? [other.wine_id, w.wine_id] : [w.wine_id, other.wine_id];
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
} else if (mode === 'twins') {
  // Copies of one wine with the same title (one per vintage listing, from before the matcher fix).
  const log = file ?? 'data/review/twins-merged.jsonl';
  const merges = await mergeTwins(db, { dryRun });
  writeFileSync(log, merges.map((m) => JSON.stringify(m)).join('\n') + '\n');
  console.log(`${dryRun ? 'would merge' : 'merged'} ${merges.length} copies into ${new Set(merges.map((m) => m.to)).size} wines -> ${log}`);
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
  console.error('usage: tsx scripts/duplicates.ts export [out.jsonl] | apply decisions.jsonl | auto-merge [--dry-run] | twins [--dry-run]');
  process.exitCode = 1;
}
await db.end();
