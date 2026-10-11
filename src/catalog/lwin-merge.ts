/**
 * Fold crawl-created wines into the LWIN entry they confidently match, in
 * wine_id order, a batch at a time. Resumable: callers pass the last wine_id
 * processed (a cursor) and get the next one back.
 */
import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { matchWine } from '../match/matcher.js';
import { aggregateWines } from '../prices/aggregate.js';
import { mergeWines } from './wines.js';

export interface MergeBatchResult {
  checked: number;
  merged: number;
  cursor: number | null; // last wine_id checked; null when there is nothing left
}

export async function mergeCrawlIntoLwin(db: pg.Pool, afterId: number, limit: number): Promise<MergeBatchResult> {
  const { rows } = await db.query(
    `SELECT wine_id, producer, display_name FROM wines WHERE source = 'crawl' AND wine_id > $1 ORDER BY wine_id LIMIT $2`,
    [afterId, limit]
  );
  const touched = new Set<number>();
  let merged = 0;
  for (const w of rows) {
    const r = await matchWine(db, { text: w.display_name, producer: w.producer || undefined }, { sources: ['lwin'] });
    if (r.outcome !== 'auto') continue;
    const target = r.candidates[0]!.wine.wine_id;
    await withTransaction(db, (c) => mergeWines(c, w.wine_id, target));
    touched.add(target);
    merged++;
  }
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 500) await aggregateWines(db, ids.slice(i, i + 500));
  return { checked: rows.length, merged, cursor: rows.length ? rows[rows.length - 1]!.wine_id : null };
}
