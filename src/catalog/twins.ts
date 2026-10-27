/**
 * Merge copies of one wine: entries with the same twin key (src/match/score.ts),
 * where all but at most one were created from shop listings. Before the
 * matcher learned to see past copies, every new vintage listing of a wine
 * that already had two copies created another, so a wine's vintages ended up
 * spread over many entries with one vintage each.
 *
 * The entry kept is the group's one catalog (LWIN or user-added) entry, else
 * the shop-created copy with the most listings (ties: the oldest). Groups with
 * two or more catalog entries are left alone: those need a person to decide.
 */
import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { twinKey } from '../match/score.js';
import { aggregateWines } from '../prices/aggregate.js';
import { mergeWines } from './wines.js';

const SHOP_SOURCES = new Set(['crawl', 'llm']);

export interface TwinMerge {
  from: number;
  to: number;
  name: string;
}

export async function mergeTwins(db: pg.Pool, opts: { dryRun?: boolean } = {}): Promise<TwinMerge[]> {
  const { rows } = await db.query<{ wine_id: number; display_name: string; source: string; listings: number }>(
    `SELECT w.wine_id, w.display_name, w.source, COUNT(l.listing_id)::int AS listings
       FROM wines w LEFT JOIN listings l USING (wine_id)
      GROUP BY w.wine_id ORDER BY w.wine_id`
  );
  const groups = new Map<string, typeof rows>();
  for (const w of rows) {
    const key = twinKey(w);
    if (key) groups.set(key, [...(groups.get(key) ?? []), w]);
  }

  const merges: TwinMerge[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const catalog = group.filter((w) => !SHOP_SOURCES.has(w.source));
    if (catalog.length > 1) continue;
    const shop = group.filter((w) => SHOP_SOURCES.has(w.source));
    const keep = catalog[0] ?? [...shop].sort((a, b) => b.listings - a.listings || a.wine_id - b.wine_id)[0]!;
    for (const w of shop) if (w.wine_id !== keep.wine_id) merges.push({ from: w.wine_id, to: keep.wine_id, name: w.display_name });
  }
  if (opts.dryRun) return merges;

  for (const m of merges) await withTransaction(db, (c) => mergeWines(c, m.from, m.to));
  const kept = [...new Set(merges.map((m) => m.to))];
  for (let i = 0; i < kept.length; i += 500) await aggregateWines(db, kept.slice(i, i + 500));
  return merges;
}
