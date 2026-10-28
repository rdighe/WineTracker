/**
 * Wine background - tasting notes, the producer's story, technical specs -
 * researched by the LLM once per wine (shared by all its vintages) and kept
 * in wine_info. Research runs in the background when someone adds the wine
 * or opens its page; the app polls GET /api/wines/:id/info until it's ready.
 *
 * Researched facts also fill blanks on the wine itself (colour, grape,
 * region...), which entries created from shop listings often lack. Values
 * already there, such as LWIN data, are never overwritten.
 */
import type { Db } from '../db/pool.js';
import type { LlmProvider, WineInfo } from '../llm/types.js';
import { getWine } from './wines.js';

/**
 * The research format. Version 2 added spec sheets and per-source tasting
 * notes; research in an older format is redone when the wine is next opened,
 * and the old notes keep showing until the new ones are in.
 */
export const INFO_VERSION = 2;

/** A failed research is tried again after this long. */
const RETRY_FAILED_HOURS = 24;
/** A 'pending' row this old was lost (the API restarted mid-research) and may be claimed again. */
const PENDING_STALE_MINUTES = 10;
const CONCURRENCY = 2;

export type InfoStatus = 'pending' | 'ready' | 'failed';

export async function getWineInfo(db: Db, wineId: number): Promise<{ status: InfoStatus; info: WineInfo | null } | null> {
  const { rows } = await db.query('SELECT status, info FROM wine_info WHERE wine_id = $1', [wineId]);
  return rows[0] ? { status: rows[0].status, info: rows[0].info } : null;
}

async function fillBlanks(db: Db, wineId: number, w: WineInfo['wine']): Promise<void> {
  await db.query(
    `UPDATE wines SET
       colour     = CASE WHEN colour = '' THEN $2 ELSE colour END,
       wine_type  = CASE WHEN wine_type = '' THEN $3 ELSE wine_type END,
       country    = CASE WHEN country = '' THEN $4 ELSE country END,
       region     = CASE WHEN region = '' THEN $5 ELSE region END,
       sub_region = CASE WHEN sub_region = '' AND (region = '' OR region = $5) THEN $6 ELSE sub_region END,
       grape      = CASE WHEN grape = '' THEN $7 ELSE grape END
     WHERE wine_id = $1`,
    [wineId, w.colour, w.wineType, w.country, w.region, w.subRegion, w.grape]
  );
}

export function createInfoResearcher(db: Db, provider: LlmProvider, log: (msg: string) => void = console.error) {
  const queue: number[] = [];
  let running = 0;
  let claiming = 0;
  let idle: Array<() => void> = [];

  async function research(wineId: number): Promise<void> {
    try {
      const wine = await getWine(db, wineId);
      if (!wine || !provider.researchWine) throw new Error('nothing to research');
      // The label of the latest scan confirmed as this wine, if any.
      const { rows: scans } = await db.query(
        `SELECT COALESCE(NULLIF(ocr_text, ''), extracted->>'rawText') AS text FROM scans
          WHERE chosen_wine_id = $1 AND COALESCE(NULLIF(ocr_text, ''), extracted->>'rawText', '') <> ''
          ORDER BY confirmed_at DESC NULLS LAST LIMIT 1`,
        [wineId]
      );
      const info = await provider.researchWine({
        displayName: wine.display_name, producer: wine.producer, region: wine.sub_region || wine.region,
        country: wine.country, grape: wine.grape, colour: wine.colour, labelText: scans[0]?.text ?? undefined,
      });
      await db.query(`UPDATE wine_info SET status = 'ready', info = $2, provider = $3, error = '', updated_at = NOW() WHERE wine_id = $1`, [wineId, JSON.stringify({ ...info, version: INFO_VERSION }), provider.name]);
      await fillBlanks(db, wineId, info.wine);
    } catch (err) {
      log(`wine info ${wineId}: ${err instanceof Error ? err.message : String(err)}`);
      await db.query(`UPDATE wine_info SET status = 'failed', error = $2, updated_at = NOW() WHERE wine_id = $1`, [wineId, String(err instanceof Error ? err.message : err).slice(0, 300)]).catch(() => {});
    }
  }

  function pump(): void {
    while (running < CONCURRENCY && queue.length) {
      const id = queue.shift()!;
      running++;
      void research(id).finally(() => {
        running--;
        pump();
      });
    }
    if (!running && !queue.length && !claiming) {
      for (const done of idle) done();
      idle = [];
    }
  }

  return {
    /** Whether this server can research wines at all. */
    available: Boolean(provider.researchWine),

    /**
     * Start researching the wine unless it is done, under way, or failed
     * recently. Returns at once; resolves true when research was started.
     */
    async request(wineId: number): Promise<boolean> {
      if (!provider.researchWine) return false;
      claiming++;
      const { rows } = await db.query(
        `INSERT INTO wine_info (wine_id, status) VALUES ($1, 'pending')
         ON CONFLICT (wine_id) DO UPDATE SET status = 'pending', error = '', updated_at = NOW()
          WHERE (wine_info.status = 'failed' AND wine_info.updated_at < NOW() - make_interval(hours => $2))
             OR (wine_info.status = 'pending' AND wine_info.updated_at < NOW() - make_interval(mins => $3))
             -- Researched in an older format: look again (spec sheets, sources).
             OR (wine_info.status = 'ready' AND COALESCE((wine_info.info->>'version')::int, 1) < $4)
         RETURNING wine_id`,
        [wineId, RETRY_FAILED_HOURS, PENDING_STALE_MINUTES, INFO_VERSION]
      ).finally(() => claiming--);
      if (rows[0]) queue.push(wineId);
      pump();
      return Boolean(rows[0]);
    },

    /** Resolves when nothing is queued or running (tests, shutdown). */
    drained(): Promise<void> {
      if (!running && !queue.length && !claiming) return Promise.resolve();
      return new Promise((resolve) => idle.push(resolve));
    },
  };
}

export type InfoResearcher = ReturnType<typeof createInfoResearcher>;
