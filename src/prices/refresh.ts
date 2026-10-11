/**
 * On-demand price refresh for one wine ("what does this cost now?").
 *
 *   1. Re-check the shop pages we already know sell this wine.
 *   2. Ask the LLM provider to search the web for more offers.
 *   3. Verify each found offer by reading the shop's own page (structured
 *      data) when robots.txt allows; an unverifiable offer is kept only if its
 *      title clearly matches the wine, at reduced confidence.
 *   4. Re-aggregate.
 *
 * Throttled per wine so repeated requests reuse the last result.
 */
import type { Db } from '../db/pool.js';
import { getWine } from '../catalog/wines.js';
import { parseTitle, per750 } from '../lib/listing.js';
import { scoreCandidates, type CandidateWine } from '../match/score.js';
import type { LlmProvider, WebPriceHit } from '../llm/types.js';
import { ProviderUnavailableError } from '../llm/types.js';
import { aggregateWines } from './aggregate.js';
import { extractOffer } from './extract.js';
import { DisallowedError, HostBlockedError, type PoliteFetcher } from './fetcher.js';
import { ensureMerchant, ingestOffer } from './ingest.js';

/** Price aggregators and marketplaces: their prices are someone else's data, not a merchant offer. */
export const EXCLUDED_DOMAINS = ['wine-searcher.com', 'vivino.com', 'winesearcher.com', 'cellartracker.com', 'liv-ex.com', 'ebay.com', 'amazon.com'];

const isExcluded = (host: string) => EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

export interface RefreshOptions {
  minIntervalHours?: number;
  maxKnownListings?: number;
  force?: boolean;
  log?: (msg: string) => void;
}

export interface RefreshOutcome {
  status: 'refreshed' | 'throttled';
  refreshId: number | null;
  rechecked: number;
  webHits: number;
  verified: number;
  unverifiedKept: number;
  searchError: string | null;
}

export async function refreshPrices(
  db: Db,
  fetcher: PoliteFetcher,
  provider: LlmProvider,
  wineId: number,
  vintageKey: string | null,
  opts: RefreshOptions = {}
): Promise<RefreshOutcome> {
  const log = opts.log ?? (() => {});
  const wine = await getWine(db, wineId);
  if (!wine) throw new Error(`wine ${wineId} not found`);

  if (!opts.force) {
    const { rows } = await db.query(
      `SELECT refresh_id FROM price_refreshes
        WHERE wine_id = $1 AND vintage_key IS NOT DISTINCT FROM $2 AND status <> 'error'
          AND started_at > NOW() - make_interval(hours => $3)
        ORDER BY started_at DESC LIMIT 1`,
      [wineId, vintageKey, opts.minIntervalHours ?? 12]
    );
    if (rows[0]) return { status: 'throttled', refreshId: rows[0].refresh_id, rechecked: 0, webHits: 0, verified: 0, unverifiedKept: 0, searchError: null };
  }

  const { rows: rr } = await db.query(
    `INSERT INTO price_refreshes (wine_id, vintage_key) VALUES ($1, $2) RETURNING refresh_id`,
    [wineId, vintageKey]
  );
  const refreshId: number = rr[0].refresh_id;
  const out: RefreshOutcome = { status: 'refreshed', refreshId, rechecked: 0, webHits: 0, verified: 0, unverifiedKept: 0, searchError: null };

  try {
    // 1. Known listings
    const { rows: known } = await db.query(
      `SELECT l.url, m.merchant_id, m.name FROM listings l JOIN merchants m USING (merchant_id)
        WHERE l.wine_id = $1 AND ($2::text IS NULL OR l.vintage_key = $2)
        ORDER BY l.last_seen_at DESC LIMIT $3`,
      [wineId, vintageKey, opts.maxKnownListings ?? 15]
    );
    for (const k of known) {
      if (await recheck(db, fetcher, k.url, k.merchant_id, k.name, log)) out.rechecked++;
    }

    // 2-3. Web search + verification
    let hits: WebPriceHit[] = [];
    try {
      hits = await provider.searchPrices({ displayName: wine.display_name, vintage: vintageKey, region: wine.region || undefined });
    } catch (err) {
      out.searchError = err instanceof ProviderUnavailableError ? 'no LLM provider configured' : (err as Error).message;
    }
    out.webHits = hits.length;
    const knownUrls = new Set(known.map((k) => k.url));
    for (const hit of hits) {
      const host = new URL(hit.url).hostname.replace(/^www\./, '');
      if (isExcluded(host) || knownUrls.has(hit.url)) continue;
      if (hit.currency !== 'USD') continue;
      if (vintageKey && hit.vintage && hit.vintage !== vintageKey) continue;
      const merchantId = await ensureMerchant(db, host, hit.merchant);
      if (await recheck(db, fetcher, hit.url, merchantId, hit.merchant, log)) {
        out.verified++;
      } else if (titleMatchesWine(hit, wine)) {
        await insertWebObservation(db, wineId, vintageKey, merchantId, hit);
        out.unverifiedKept++;
      }
    }

    await aggregateWines(db, [wineId]);
    await db.query(
      `UPDATE price_refreshes SET status = 'done', found = $2, finished_at = NOW() WHERE refresh_id = $1`,
      [refreshId, out.rechecked + out.verified + out.unverifiedKept]
    );
    return out;
  } catch (err) {
    await db.query(`UPDATE price_refreshes SET status = 'error', error = $2, finished_at = NOW() WHERE refresh_id = $1`, [
      refreshId,
      (err as Error).message.slice(0, 500),
    ]);
    throw err;
  }
}

/** Fetch a shop page and ingest its structured offer. True if a price was recorded or refreshed. */
async function recheck(db: Db, fetcher: PoliteFetcher, url: string, merchantId: number, merchantName: string, log: (m: string) => void): Promise<boolean> {
  try {
    const page = await fetcher.get(url);
    if (page.status !== 200) return false;
    const offer = extractOffer(page.body);
    if (!offer) return false;
    const r = await ingestOffer(db, { merchantId, merchantName, url, offer }, { createWines: false });
    return r.status === 'priced';
  } catch (err) {
    if (!(err instanceof DisallowedError || err instanceof HostBlockedError)) log(`recheck ${url}: ${(err as Error).message}`);
    return false;
  }
}

function titleMatchesWine(hit: WebPriceHit, wine: CandidateWine & { display_name: string }): boolean {
  const parsed = parseTitle(hit.title || '');
  if (!hit.title || !parsed.isWine) return false;
  const [scored] = scoreCandidates({ text: parsed.rest }, [wine]);
  return (scored?.score ?? 0) >= 0.7;
}

async function insertWebObservation(db: Db, wineId: number, vintageKey: string | null, merchantId: number, hit: WebPriceHit) {
  const parsed = parseTitle(hit.title);
  const bottleMl = hit.bottleMl ?? parsed.bottleMl ?? 750;
  const pack = hit.packSize > 1 ? hit.packSize : parsed.packSize;
  await db.query(
    `INSERT INTO price_observations (wine_id, vintage_key, bottle_ml, pack_size, price_cents, unit_750_cents, currency,
                                     in_stock, source_type, merchant_id, url, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,'web_search',$8,$9,0.5)`,
    [wineId, hit.vintage || vintageKey, bottleMl, pack, hit.priceCents, per750(hit.priceCents, bottleMl, pack), hit.inStock, merchantId, hit.url]
  );
}
