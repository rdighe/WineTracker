/**
 * Market price per wine + vintage from raw observations.
 *
 *  - Window, per vintage (and for all vintages together): last 30 days; if
 *    that vintage has nothing that recent, last 365 days (window_days records
 *    which one was used, so the UI can say "as of"). Shops sell the current
 *    release daily while older vintages turn up now and then; a per-wine
 *    window would hide those older vintages as soon as one fresh offer arrived.
 *  - One vote per offer: only the latest observation per listing/URL counts,
 *    so a shop crawled daily doesn't outweigh one crawled monthly.
 *  - Outliers (mis-sized bottles, typos, mismatched wines) are dropped with a
 *    median-absolute-deviation test in log space before taking percentiles.
 *  - Restaurant prices and user-reported prices at tasting are excluded:
 *    this is the retail market price.
 */
import type { Db } from '../db/pool.js';

export const WINDOWS = [30, 365];
const MAD_LIMIT = 3.5;

export interface PriceSummary {
  median: number;
  p10: number;
  p90: number;
  n: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Robust filter: drop values far from the median in log space. */
export function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const logs = values.map(Math.log);
  const med = quantile([...logs].sort((a, b) => a - b), 0.5);
  const mad = quantile(logs.map((l) => Math.abs(l - med)).sort((a, b) => a - b), 0.5);
  // With a tiny MAD (most offers at one price) fall back to a ±60% band.
  const limit = Math.max(mad * 1.4826 * MAD_LIMIT, Math.log(1.6));
  return values.filter((_, i) => Math.abs(logs[i]! - med) <= limit);
}

export function summarize(values: number[]): PriceSummary | null {
  const kept = removeOutliers(values).sort((a, b) => a - b);
  if (!kept.length) return null;
  return {
    median: Math.round(quantile(kept, 0.5)),
    p10: Math.round(quantile(kept, 0.1)),
    p90: Math.round(quantile(kept, 0.9)),
    n: kept.length,
  };
}

interface ObsRow {
  vintage_key: string | null;
  unit_750_cents: number;
  merchant_key: string;
  observed_at: Date;
}

/** Recompute wine_prices and wine_price_daily for the given wines. */
export async function aggregateWines(db: Db, wineIds: number[]): Promise<void> {
  for (const wineId of wineIds) {
    await db.query('DELETE FROM wine_prices WHERE wine_id = $1', [wineId]);
    const longest = WINDOWS[WINDOWS.length - 1]!;
    const { rows } = await db.query<ObsRow>(
      `SELECT DISTINCT ON (COALESCE(listing_id::text, url, observation_id::text), vintage_key)
              vintage_key, unit_750_cents,
              COALESCE(merchant_id::text, regexp_replace(url, '^https?://(www\\.)?([^/]+).*$', '\\2')) AS merchant_key,
              observed_at
         FROM price_observations
        WHERE wine_id = $1 AND currency = 'USD' AND context = 'retail' AND source_type <> 'user'
          AND observed_at > NOW() - make_interval(days => $2)
          AND (in_stock IS DISTINCT FROM FALSE)
        ORDER BY COALESCE(listing_id::text, url, observation_id::text), vintage_key, observed_at DESC`,
      [wineId, longest]
    );
    const groups = new Map<string, ObsRow[]>();
    for (const r of rows) {
      if (r.vintage_key) groups.set(r.vintage_key, [...(groups.get(r.vintage_key) ?? []), r]);
      groups.set('*', [...(groups.get('*') ?? []), r]);
    }
    for (const [vintageKey, all] of groups) {
      // The shortest window with offers for this vintage wins.
      for (const days of WINDOWS) {
        const since = Date.now() - days * 86400000;
        const obs = all.filter((o) => +o.observed_at > since);
        const s = obs.length ? summarize(obs.map((o) => o.unit_750_cents)) : null;
        if (!s) continue;
        await db.query(
          `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants,
                                    window_days, latest_observed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [wineId, vintageKey, s.median, s.p10, s.p90, s.n, new Set(obs.map((o) => o.merchant_key)).size, days,
           new Date(Math.max(...obs.map((o) => +o.observed_at)))]
        );
        break;
      }
    }

    // Daily history (all observations, not just the window).
    await db.query('DELETE FROM wine_price_daily WHERE wine_id = $1', [wineId]);
    await db.query(
      `INSERT INTO wine_price_daily (wine_id, vintage_key, day, median_cents, n)
       SELECT wine_id, v, day, percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_750_cents)::int, COUNT(*)
         FROM (SELECT wine_id, unit_750_cents, (observed_at AT TIME ZONE 'UTC')::date AS day,
                      unnest(ARRAY[COALESCE(vintage_key, '?'), '*']) AS v
                 FROM price_observations
                WHERE wine_id = $1 AND currency = 'USD' AND context = 'retail' AND source_type <> 'user') o
        WHERE v <> '?'
        GROUP BY wine_id, v, day`,
      [wineId]
    );
    await db.query('UPDATE wines SET prices_computed_at = NOW() WHERE wine_id = $1', [wineId]);
  }
}

/** Wines with observations newer than their aggregate (for batch runs). */
export async function staleWineIds(db: Db): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT w.wine_id FROM wines w
      WHERE EXISTS (SELECT 1 FROM price_observations o
                     WHERE o.wine_id = w.wine_id
                       AND (w.prices_computed_at IS NULL OR o.observed_at > w.prices_computed_at))`
  );
  return rows.map((r) => r.wine_id);
}
