/**
 * A user's tasting log. Each tasting can carry the price paid; that price is
 * also stored as a 'user' price observation so "price then vs market now"
 * comes from one place, without moving the market price.
 */
import type { Db } from '../db/pool.js';
import { per750 } from '../lib/listing.js';
import { normalizeTags } from '../lib/tags.js';
import { sanitizeNoteFlavors } from '../llm/sanitize.js';
import { noteHash } from './noteFlavors.js';

export interface TastingInput {
  wineId: number;
  vintage?: string | null;
  rating?: number | null;
  notes?: string;
  tags?: string[];
  pricePaid?: number | null;       // dollars
  priceContext?: 'retail' | 'restaurant' | null;
  bottleMl?: number;
  location?: string;
  /** Where a tasted wine was drunk; ignored for cellar bottles. */
  setting?: 'home' | 'restaurant' | 'other' | null;
  tastedOn?: string;               // YYYY-MM-DD
  scanId?: number | null;
  /** 'cellar': bottles you own (maybe not opened yet); 'tasted': drunk somewhere. */
  kind?: 'tasted' | 'cellar';
  bottles?: number | null;
  /** Where an imported entry came from ("vivino:<id>"); importing it again is a no-op. */
  externalRef?: string | null;
  /** Flavors the phone read from these notes and tags (Apple Intelligence): family -> intensity 1-3. */
  noteFlavors?: Partial<Record<string, number>> | null;
}

/** Keep flavors the phone read, marked as read from the tasting's current notes and tags. */
async function storeNoteFlavors(db: Db, tastingId: number, notes: string | undefined, tags: string[], raw: TastingInput['noteFlavors']): Promise<void> {
  const hash = noteHash(notes, tags);
  const nf = sanitizeNoteFlavors(raw);
  if (!hash || !nf) return;
  await db.query(
    `UPDATE tastings SET note_flavors = $2, note_flavors_source = 'apple', note_flavors_for = $3 WHERE tasting_id = $1`,
    [tastingId, JSON.stringify(nf), hash]
  );
}

async function recordPrice(db: Db, userId: number, t: TastingInput): Promise<number | null> {
  if (!t.pricePaid) return null;
  const cents = Math.round(t.pricePaid * 100);
  const ml = t.bottleMl ?? 750;
  const { rows } = await db.query(
    `INSERT INTO price_observations (wine_id, vintage_key, bottle_ml, price_cents, unit_750_cents, context, source_type, url, observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'user', $7, COALESCE($8::date::timestamptz, NOW())) RETURNING observation_id`,
    [t.wineId, t.vintage ?? null, ml, cents, per750(cents, ml, 1), t.priceContext ?? 'retail', `user:${userId}`, t.tastedOn ?? null]
  );
  return rows[0].observation_id;
}

/** Returns the new tasting's id, or null when an entry with the same externalRef already exists. */
export async function createTasting(db: Db, userId: number, t: TastingInput): Promise<number | null> {
  if (t.externalRef) {
    const dup = await db.query('SELECT 1 FROM tastings WHERE user_id = $1 AND external_ref = $2', [userId, t.externalRef]);
    if (dup.rows[0]) return null;
  }
  const observationId = await recordPrice(db, userId, t);
  const kind = t.kind ?? 'tasted';
  const { rows } = await db.query(
    `INSERT INTO tastings (user_id, wine_id, vintage_key, rating, notes, tags, price_paid_cents, price_context, bottle_ml,
                           location, tasted_on, scan_id, observation_id, kind, bottles, external_ref, setting)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::date, CURRENT_DATE),$12,$13,$14,$15,$16,$17) RETURNING tasting_id`,
    [userId, t.wineId, t.vintage ?? null, t.rating ?? null, t.notes ?? '', JSON.stringify(normalizeTags(t.tags ?? [])),
     t.pricePaid ? Math.round(t.pricePaid * 100) : null, t.pricePaid ? t.priceContext ?? 'retail' : null, t.bottleMl ?? 750,
     t.location ?? '', t.tastedOn ?? null, t.scanId ?? null, observationId, kind,
     kind === 'cellar' ? t.bottles ?? 1 : null, t.externalRef ?? null, kind === 'cellar' ? null : t.setting ?? null]
  );
  if (t.noteFlavors) await storeNoteFlavors(db, rows[0].tasting_id, t.notes, normalizeTags(t.tags ?? []), t.noteFlavors);
  return rows[0].tasting_id;
}

export async function updateTasting(db: Db, userId: number, tastingId: number, t: Partial<TastingInput>): Promise<boolean> {
  const { rows } = await db.query('SELECT * FROM tastings WHERE tasting_id = $1 AND user_id = $2', [tastingId, userId]);
  const cur = rows[0];
  if (!cur) return false;
  const merged: TastingInput = {
    // A different wine: the entry was matched to the wrong one.
    wineId: t.wineId ?? cur.wine_id,
    vintage: t.vintage !== undefined ? t.vintage : cur.vintage_key,
    rating: t.rating !== undefined ? t.rating : cur.rating === null ? null : Number(cur.rating),
    notes: t.notes ?? cur.notes,
    tags: t.tags ?? cur.tags,
    pricePaid: t.pricePaid !== undefined ? t.pricePaid : cur.price_paid_cents === null ? null : cur.price_paid_cents / 100,
    priceContext: t.priceContext !== undefined ? t.priceContext : cur.price_context,
    bottleMl: t.bottleMl ?? cur.bottle_ml,
    location: t.location ?? cur.location,
    tastedOn: t.tastedOn ?? cur.tasted_on.toISOString().slice(0, 10),
    kind: t.kind ?? cur.kind,
    bottles: t.bottles !== undefined ? t.bottles : cur.bottles,
    setting: t.setting !== undefined ? t.setting : cur.setting,
  };
  const wineChanged = merged.wineId !== cur.wine_id;
  const priceChanged = wineChanged || t.pricePaid !== undefined || t.priceContext !== undefined || t.bottleMl !== undefined || t.vintage !== undefined || t.tastedOn !== undefined;
  let observationId = cur.observation_id;
  if (priceChanged) {
    if (observationId) await db.query('DELETE FROM price_observations WHERE observation_id = $1', [observationId]);
    observationId = await recordPrice(db, userId, merged);
  }
  await db.query(
    `UPDATE tastings SET wine_id = $16, vintage_key = $3, rating = $4, notes = $5, tags = $6, price_paid_cents = $7, price_context = $8,
            bottle_ml = $9, location = $10, tasted_on = $11::date, observation_id = $12, kind = $13, bottles = $14, setting = $15, updated_at = NOW()
      WHERE tasting_id = $1 AND user_id = $2`,
    [tastingId, userId, merged.vintage ?? null, merged.rating ?? null, merged.notes ?? '', JSON.stringify(normalizeTags(merged.tags ?? [])),
     merged.pricePaid ? Math.round(merged.pricePaid * 100) : null, merged.pricePaid ? merged.priceContext ?? 'retail' : null,
     merged.bottleMl ?? 750, merged.location ?? '', merged.tastedOn, observationId, merged.kind ?? 'tasted',
     merged.kind === 'cellar' ? merged.bottles ?? 1 : null, merged.kind === 'cellar' ? null : merged.setting ?? null, merged.wineId]
  );
  const tags = normalizeTags(merged.tags ?? []);
  // New words: read them afresh, even if the last read failed a moment ago.
  if (noteHash(merged.notes, tags) !== noteHash(cur.notes, cur.tags)) {
    await db.query('UPDATE tastings SET note_flavors_tried_at = NULL WHERE tasting_id = $1', [tastingId]);
  }
  if (t.noteFlavors) await storeNoteFlavors(db, tastingId, merged.notes, tags, t.noteFlavors);
  return true;
}

export async function deleteTasting(db: Db, userId: number, tastingId: number): Promise<boolean> {
  const { rows } = await db.query('DELETE FROM tastings WHERE tasting_id = $1 AND user_id = $2 RETURNING observation_id', [tastingId, userId]);
  if (!rows[0]) return false;
  if (rows[0].observation_id) await db.query('DELETE FROM price_observations WHERE observation_id = $1', [rows[0].observation_id]);
  return true;
}

/**
 * Take a cellar entry out of the cellar. Tasting records stay: an entry that
 * carries a rating, notes or tags becomes a tasting (they were written about
 * the wine); a bare cellar entry is deleted. Returns null when the entry isn't
 * the user's, 'not_cellar' when it isn't in the cellar.
 */
export async function removeFromCellar(db: Db, userId: number, tastingId: number): Promise<{ kept: boolean } | null | 'not_cellar'> {
  const { rows } = await db.query('SELECT kind, rating, notes, tags FROM tastings WHERE tasting_id = $1 AND user_id = $2', [tastingId, userId]);
  const t = rows[0];
  if (!t) return null;
  if (t.kind !== 'cellar') return 'not_cellar';
  const hasNotes = t.rating !== null || Boolean(t.notes?.trim()) || (Array.isArray(t.tags) && t.tags.length > 0);
  if (!hasNotes) {
    await deleteTasting(db, userId, tastingId);
    return { kept: false };
  }
  await db.query(`UPDATE tastings SET kind = 'tasted', bottles = NULL, updated_at = NOW() WHERE tasting_id = $1 AND user_id = $2`, [tastingId, userId]);
  return { kept: true };
}

/**
 * Tastings with the wine, what was paid (per 750 ml), and the market price
 * now for the same vintage (falling back to all vintages).
 */
export async function listTastings(db: Db, userId: number, opts: { limit?: number; before?: number } = {}) {
  const { rows } = await db.query(
    `SELECT t.tasting_id, t.wine_id, w.display_name, w.producer, w.region, w.sub_region, w.country, w.colour, w.grape, w.wine_type, t.vintage_key,
            t.rating::float AS rating, t.notes, t.tags, t.price_paid_cents, t.price_context, t.bottle_ml, t.location,
            to_char(t.tasted_on, 'YYYY-MM-DD') AS tasted_on, t.kind, t.bottles, t.setting, w.image_url,
            CASE WHEN t.price_paid_cents IS NULL THEN NULL ELSE round(t.price_paid_cents * 750.0 / t.bottle_ml)::int END AS paid_750_cents,
            COALESCE(pv.median_cents, pa.median_cents) AS market_now_cents,
            CASE WHEN pv.median_cents IS NOT NULL THEN t.vintage_key ELSE CASE WHEN pa.median_cents IS NOT NULL THEN '*' END END AS market_vintage_key
       FROM tastings t
       JOIN wines w USING (wine_id)
       LEFT JOIN wine_prices pv ON pv.wine_id = t.wine_id AND pv.vintage_key = t.vintage_key AND pv.currency = 'USD'
       LEFT JOIN wine_prices pa ON pa.wine_id = t.wine_id AND pa.vintage_key = '*' AND pa.currency = 'USD'
      WHERE t.user_id = $1 AND ($2::bigint IS NULL OR t.tasting_id < $2)
      ORDER BY t.tasted_on DESC, t.tasting_id DESC
      LIMIT $3`,
    [userId, opts.before ?? null, Math.min(opts.limit ?? 50, 1000)]
  );
  return rows;
}
