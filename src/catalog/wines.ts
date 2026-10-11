import type { Db } from '../db/pool.js';
import { identityTokens, normalize } from '../lib/normalize.js';

export interface NewWine {
  lwin?: string | null;
  producer: string;
  name: string;
  display_name?: string;
  country?: string;
  region?: string;
  sub_region?: string;
  colour?: string;
  wine_type?: string;
  grape?: string;
  classification?: string;
  source: 'lwin' | 'crawl' | 'user' | 'llm';
}

const COLOURS = new Set(['red', 'white', 'rose']);

export function displayName(w: Pick<NewWine, 'producer' | 'name'>): string {
  const p = w.producer.trim();
  const n = w.name.trim();
  if (!n) return p;
  if (!p || normalize(n).startsWith(normalize(p))) return n;
  return `${p} ${n}`;
}

/** Producer reduced to its identity words ("Ridge Vineyards" -> "ridge"), for retrieval. */
export function producerNorm(producer: string): string {
  return identityTokens(producer).join(' ') || normalize(producer);
}

export function searchNorm(w: NewWine): string {
  return normalize([w.producer, w.name, w.sub_region, w.region, w.grape].filter(Boolean).join(' '));
}

/** Identity tokens of a wine plus adjacent joins ("lynch bages" -> also "lynchbages"), for indexed lookup. */
export function wineTokens(w: Pick<NewWine, 'producer' | 'name' | 'display_name'>): string[] {
  const base = identityTokens([w.producer, w.name, w.display_name].filter(Boolean).join(' '));
  const joins = base.slice(0, -1).map((t, i) => t + base[i + 1]!);
  return [...new Set([...base, ...joins])];
}

function row(w: NewWine) {
  const colour = (w.colour ?? '').toLowerCase().replace('rosé', 'rose');
  return [
    w.lwin ?? null,
    w.producer.trim(),
    w.name.trim(),
    (w.display_name ?? displayName(w)).trim(),
    w.country ?? '',
    w.region ?? '',
    w.sub_region ?? '',
    COLOURS.has(colour) ? colour : '',
    w.wine_type ?? '',
    w.grape ?? '',
    w.classification ?? '',
    w.source,
    producerNorm(w.producer),
    searchNorm(w),
    wineTokens(w),
  ];
}

const COLS = `lwin, producer, name, display_name, country, region, sub_region, colour, wine_type, grape,
  classification, source, producer_norm, search_norm, tokens`;

export async function createWine(db: Db, w: NewWine): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO wines (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING wine_id`,
    row(w)
  );
  return rows[0].wine_id;
}

/** Insert or update by LWIN (catalog re-imports are idempotent). */
export async function upsertLwinWine(db: Db, w: NewWine & { lwin: string }): Promise<void> {
  await db.query(
    `INSERT INTO wines (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (lwin) DO UPDATE SET
       producer = EXCLUDED.producer, name = EXCLUDED.name, display_name = EXCLUDED.display_name,
       country = EXCLUDED.country, region = EXCLUDED.region, sub_region = EXCLUDED.sub_region,
       colour = EXCLUDED.colour, wine_type = EXCLUDED.wine_type, classification = EXCLUDED.classification,
       producer_norm = EXCLUDED.producer_norm, search_norm = EXCLUDED.search_norm, tokens = EXCLUDED.tokens,
       updated_at = NOW()`,
    row(w)
  );
}

export async function addAlias(db: Db, wineId: number, alias: string, source: string): Promise<void> {
  const a = normalize(alias);
  if (a.length < 3) return;
  await db.query(
    `INSERT INTO wine_aliases (wine_id, alias_norm, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [wineId, a, source]
  );
}

export async function getWine(db: Db, wineId: number) {
  const { rows } = await db.query('SELECT * FROM wines WHERE wine_id = $1', [wineId]);
  return rows[0] ?? null;
}

/**
 * Fold wine `fromId` into `toId`: listings, observations, aliases, scans and
 * refreshes move over, the old name becomes an alias, the old row is deleted.
 * Callers re-aggregate prices for `toId` afterwards.
 */
export async function mergeWines(db: Db, fromId: number, toId: number): Promise<void> {
  if (fromId === toId) return;
  const from = await getWine(db, fromId);
  if (!from) return;
  await db.query('UPDATE listings SET wine_id = $2 WHERE wine_id = $1', [fromId, toId]);
  await db.query('UPDATE price_observations SET wine_id = $2 WHERE wine_id = $1', [fromId, toId]);
  await db.query('UPDATE scans SET chosen_wine_id = $2 WHERE chosen_wine_id = $1', [fromId, toId]);
  await db.query('UPDATE price_refreshes SET wine_id = $2 WHERE wine_id = $1', [fromId, toId]);
  await db.query('UPDATE tastings SET wine_id = $2 WHERE wine_id = $1', [fromId, toId]);
  await db.query(
    `INSERT INTO saved_wines (user_id, wine_id, vintage_key, created_at)
     SELECT user_id, $2, vintage_key, created_at FROM saved_wines WHERE wine_id = $1 ON CONFLICT DO NOTHING`,
    [fromId, toId]
  );
  await db.query(
    `INSERT INTO wine_aliases (wine_id, alias_norm, source)
     SELECT $2, alias_norm, source FROM wine_aliases WHERE wine_id = $1 ON CONFLICT DO NOTHING`,
    [fromId, toId]
  );
  await addAlias(db, toId, from.display_name, 'merge');
  await db.query('DELETE FROM wines WHERE wine_id = $1', [fromId]);
}
