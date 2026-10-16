/**
 * Reference photos: a product shot for each wine, taken from the shop
 * listings we already crawl.
 *
 * Preference: a listing of the same wine and vintage, then the same wine in
 * any vintage, then another wine of the same producer and colour. Whatever is
 * picked must be a packshot on a white background - checked on the image
 * itself (the border is near-white and the frame is portrait or square), so a
 * lifestyle photo or banner is never used.
 */
import sharp from 'sharp';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { wineFeatures, type WineRow } from '../recs/features.js';

export type ImageMatch = 'vintage' | 'wine' | 'producer';

type FetchFn = typeof fetch;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TRIES = 8;
/** Wines without a usable photo are looked at again after this long (new listings may have arrived). */
export const RECHECK_DAYS = 7;

/**
 * A product shot on white (or a light studio grey): the top corners - beside
 * the bottle's neck, background in any packshot - are light and neutral, so is
 * a good part of the border (tight crops let the bottle fill the sides), and
 * the frame isn't landscape. Lifestyle photos, coloured placeholders and
 * banners fail.
 */
export async function isWhitePackshot(image: Buffer): Promise<boolean> {
  const img = sharp(image, { failOn: 'none' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height || meta.height < 250 || meta.width < 60) return false;
  if (meta.height / meta.width < 0.9) return false;
  const W = 40;
  const H = 60;
  const { data } = await img.flatten({ background: '#ffffff' }).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const light = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    return Math.min(r, g, b) >= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 25;
  };
  const share = (x0: number, x1: number, y0: number, y1: number) => {
    let n = 0, hit = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (light(x, y)) hit++; }
    return hit / n;
  };
  const cw = Math.round(W * 0.25), ch = Math.round(H * 0.15);
  if (share(0, cw, 0, ch) < 0.92 || share(W - cw, W, 0, ch) < 0.92) return false;
  let border = 0, hit = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x > 1 && x < W - 2 && y > 1 && y < H - 2) continue;
    border++;
    if (light(x, y)) hit++;
  }
  return hit / border >= 0.3;
}

async function download(url: string, fetchImpl: FetchFn): Promise<Buffer | null> {
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': config.crawlerUserAgent, Accept: 'image/*' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_BYTES ? null : buf;
  } catch {
    return null;
  }
}

/**
 * Pick and store a reference photo for a wine. Returns the stored URL, or null
 * when nothing suitable exists yet (the wine is marked checked either way).
 */
export async function findWineImage(db: Db, wineId: number, vintage?: string | null, fetchImpl: FetchFn = fetch): Promise<string | null> {
  const { rows: [wine] } = await db.query('SELECT * FROM wines WHERE wine_id = $1', [wineId]);
  if (!wine) return null;
  const colour = wineFeatures(wine as WineRow).colour ?? '';
  const { rows } = await db.query(
    `SELECT l.image_url, l.wine_id AS listing_wine, l.vintage_key, w.wine_id, w.display_name, w.producer, w.grape, w.colour,
            w.wine_type, w.region, w.sub_region, w.country
       FROM listings l JOIN wines w ON w.wine_id = l.wine_id
      WHERE l.image_url IS NOT NULL AND l.match_status <> 'not_wine'
        AND (l.wine_id = $1 OR ($2 <> '' AND w.producer_norm = $2))
      ORDER BY l.last_seen_at DESC LIMIT 200`,
    [wineId, wine.producer_norm ?? '']
  );

  const tiered: Array<{ url: string; match: ImageMatch; tier: number }> = [];
  for (const r of rows) {
    let match: ImageMatch;
    if (r.listing_wine === wineId) match = vintage && r.vintage_key === vintage ? 'vintage' : 'wine';
    else {
      // Another wine of the producer only counts when both colours are known and the same.
      const other = wineFeatures(r as WineRow).colour ?? '';
      if (!colour || other !== colour) continue;
      match = 'producer';
    }
    tiered.push({ url: r.image_url, match, tier: match === 'vintage' ? 0 : match === 'wine' ? 1 : 2 });
  }
  tiered.sort((a, b) => a.tier - b.tier);

  const seen = new Set<string>();
  let tries = 0;
  for (const c of tiered) {
    if (seen.has(c.url) || tries >= MAX_TRIES) continue;
    seen.add(c.url);
    tries++;
    const buf = await download(c.url, fetchImpl);
    if (!buf || !(await isWhitePackshot(buf).catch(() => false))) continue;
    await db.query('UPDATE wines SET image_url = $2, image_match = $3, image_checked_at = NOW() WHERE wine_id = $1', [wineId, c.url, c.match]);
    return c.url;
  }
  await db.query('UPDATE wines SET image_checked_at = NOW() WHERE wine_id = $1', [wineId]);
  return null;
}

// One lookup at a time, in the background: callers never wait on image downloads.
const queue: Array<{ db: Db; wineId: number; vintage?: string | null }> = [];
const queued = new Set<number>();
let running = false;

export function queueWineImage(db: Db, wineId: number, vintage?: string | null): void {
  if (queued.has(wineId)) return;
  queued.add(wineId);
  queue.push({ db, wineId, vintage });
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      await findWineImage(job.db, job.wineId, job.vintage);
    } catch {
      // Best effort: a failed lookup is retried after RECHECK_DAYS.
    } finally {
      queued.delete(job.wineId);
    }
  }
  running = false;
}

/** Queue a lookup when the wine has no photo and wasn't checked recently. */
export function maybeQueueWineImage(db: Db, wine: { wine_id: number; image_url?: string | null; image_checked_at?: Date | null }, vintage?: string | null): void {
  if (wine.image_url) return;
  const checked = wine.image_checked_at ? new Date(wine.image_checked_at).getTime() : 0;
  if (Date.now() - checked < RECHECK_DAYS * 86_400_000) return;
  queueWineImage(db, wine.wine_id, vintage);
}
