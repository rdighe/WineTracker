/**
 * Wine photos through our own API. The phone asks GET /api/photo?u=<the
 * wine's image_url>; the first time, the server fetches the shop's image,
 * resizes it to what the app shows, and keeps it in the photos table. Only
 * URLs that are some wine's photo are served, so this is not an open proxy.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';

type FetchFn = typeof fetch;

const MAX_BYTES = 6 * 1024 * 1024;
/** A shop that gave no image is asked again after this long. */
const RETRY_FAILED_MS = 24 * 3600_000;

export interface Photo { bytes: Buffer; contentType: string }

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const inflight = new Map<string, Promise<Photo | null>>();

export async function getPhoto(db: Db, url: string, fetchImpl: FetchFn = fetch): Promise<Photo | null> {
  const key = md5(url);
  const { rows: [cached] } = await db.query('SELECT bytes, content_type, fetched_at FROM photos WHERE url_md5 = $1', [key]);
  if (cached?.bytes) return { bytes: cached.bytes, contentType: cached.content_type };
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < RETRY_FAILED_MS) return null;
  const { rows: known } = await db.query('SELECT 1 FROM wines WHERE md5(image_url) = $1 AND image_url = $2 LIMIT 1', [key, url]);
  if (!known.length) return null;

  let job = inflight.get(key);
  if (!job) {
    job = fetchAndStore(db, key, url, fetchImpl).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

async function fetchAndStore(db: Db, key: string, url: string, fetchImpl: FetchFn): Promise<Photo | null> {
  let photo: Photo | null = null;
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': config.crawlerUserAgent, Accept: 'image/*' }, signal: AbortSignal.timeout(12_000) });
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    if (buf && buf.length <= MAX_BYTES) {
      // Big enough for the full-width photo on a wine's page; packshots are shown on white, so flatten onto white.
      const bytes = await sharp(buf, { failOn: 'none' })
        .rotate()
        .resize({ width: 900, height: 1200, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      photo = { bytes, contentType: 'image/jpeg' };
    }
  } catch {
    // Unreachable shop or not an image: remembered as a miss, tried again tomorrow.
  }
  await db.query(
    `INSERT INTO photos (url_md5, url, bytes, content_type, fetched_at) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (url_md5) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type, fetched_at = NOW()`,
    [key, url, photo?.bytes ?? null, photo?.contentType ?? 'image/jpeg']
  );
  return photo;
}
