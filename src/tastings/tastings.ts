/**
 * A user's tasting log. Each tasting can carry the price paid; that price is
 * also stored as a 'user' price observation so "price then vs market now"
 * comes from one place, without moving the market price.
 */
import { canEdit, cellarForNew, CellarError, trimPlaces, type Role } from '../cellars/cellars.js';
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
  /** Which cellar a cellar entry is in (default: the person's first); ignored for tastings. */
  cellarId?: number | null;
  /** The receipt these bottles were bought on (src/cellars/receipts.ts). */
  receiptId?: number | null;
}

/**
 * A tasting the person may change, or null. A cellar entry belongs to its
 * cellar: its owners and editors may change it, whoever added it. Anything
 * else is the person's own.
 */
async function editable(db: Db, userId: number, tastingId: number) {
  const { rows: [t] } = await db.query(
    `SELECT t.*, m.role FROM tastings t
       LEFT JOIN cellar_members m ON m.cellar_id = t.cellar_id AND m.user_id = $2
      WHERE t.tasting_id = $1`,
    [tastingId, userId]
  );
  if (!t) return null;
  if (t.kind === 'cellar' && t.cellar_id) {
    if (!t.role) return null;
    if (!canEdit(t.role as Role)) throw new CellarError(403, 'You can look at this cellar but not change it.');
    return t;
  }
  return Number(t.user_id) === userId ? t : null;
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
  const kind = t.kind ?? 'tasted';
  const cellarId = kind === 'cellar' ? await cellarForNew(db, userId, t.cellarId) : null;
  const observationId = await recordPrice(db, userId, t);
  const { rows } = await db.query(
    `INSERT INTO tastings (user_id, wine_id, vintage_key, rating, notes, tags, price_paid_cents, price_context, bottle_ml,
                           location, tasted_on, scan_id, observation_id, kind, bottles, external_ref, setting, cellar_id, receipt_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::date, CURRENT_DATE),$12,$13,$14,$15,$16,$17,$18,$19) RETURNING tasting_id`,
    [userId, t.wineId, t.vintage ?? null, t.rating ?? null, t.notes ?? '', JSON.stringify(normalizeTags(t.tags ?? [])),
     t.pricePaid ? Math.round(t.pricePaid * 100) : null, t.pricePaid ? t.priceContext ?? 'retail' : null, t.bottleMl ?? 750,
     t.location ?? '', t.tastedOn ?? null, t.scanId ?? null, observationId, kind,
     kind === 'cellar' ? t.bottles ?? 1 : null, t.externalRef ?? null, kind === 'cellar' ? null : t.setting ?? null,
     cellarId, t.receiptId ?? null]
  );
  if (t.noteFlavors) await storeNoteFlavors(db, rows[0].tasting_id, t.notes, normalizeTags(t.tags ?? []), t.noteFlavors);
  return rows[0].tasting_id;
}

export async function updateTasting(db: Db, userId: number, tastingId: number, t: Partial<TastingInput>): Promise<boolean> {
  const cur = await editable(db, userId, tastingId);
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
  // A cellar entry stays in its cellar unless moved (to one the person can add to); a tasting is in none.
  const cellarId = merged.kind !== 'cellar' ? null
    : t.cellarId && t.cellarId !== cur.cellar_id ? await cellarForNew(db, userId, t.cellarId)
    : cur.cellar_id ?? await cellarForNew(db, userId, null);
  const wineChanged = merged.wineId !== cur.wine_id;
  const priceChanged = wineChanged || t.pricePaid !== undefined || t.priceContext !== undefined || t.bottleMl !== undefined || t.vintage !== undefined || t.tastedOn !== undefined;
  let observationId = cur.observation_id;
  if (priceChanged) {
    if (observationId) await db.query('DELETE FROM price_observations WHERE observation_id = $1', [observationId]);
    observationId = await recordPrice(db, Number(cur.user_id), merged);
  }
  await db.query(
    `UPDATE tastings SET wine_id = $16, vintage_key = $3, rating = $4, notes = $5, tags = $6, price_paid_cents = $7, price_context = $8,
            bottle_ml = $9, location = $10, tasted_on = $11::date, observation_id = $12, kind = $13, bottles = $14, setting = $15,
            cellar_id = $2, receipt_id = $17, updated_at = NOW()
      WHERE tasting_id = $1`,
    [tastingId, cellarId, merged.vintage ?? null, merged.rating ?? null, merged.notes ?? '', JSON.stringify(normalizeTags(merged.tags ?? [])),
     merged.pricePaid ? Math.round(merged.pricePaid * 100) : null, merged.pricePaid ? merged.priceContext ?? 'retail' : null,
     merged.bottleMl ?? 750, merged.location ?? '', merged.tastedOn, observationId, merged.kind ?? 'tasted',
     merged.kind === 'cellar' ? merged.bottles ?? 1 : null, merged.kind === 'cellar' ? null : merged.setting ?? null, merged.wineId,
     t.receiptId !== undefined ? t.receiptId : cur.receipt_id]
  );
  // Places on a rack: none outside a cellar or in another one; no more than the bottles left.
  if (cellarId !== cur.cellar_id) await db.query('DELETE FROM cellar_slots WHERE tasting_id = $1', [tastingId]);
  else if (merged.kind === 'cellar') await trimPlaces(db, tastingId, merged.bottles ?? 1);
  const tags = normalizeTags(merged.tags ?? []);
  // New words: read them afresh, even if the last read failed a moment ago.
  if (noteHash(merged.notes, tags) !== noteHash(cur.notes, cur.tags)) {
    await db.query('UPDATE tastings SET note_flavors_tried_at = NULL WHERE tasting_id = $1', [tastingId]);
  }
  if (t.noteFlavors) await storeNoteFlavors(db, tastingId, merged.notes, tags, t.noteFlavors);
  return true;
}

export async function deleteTasting(db: Db, userId: number, tastingId: number): Promise<boolean> {
  if (!(await editable(db, userId, tastingId))) return false;
  const { rows } = await db.query('DELETE FROM tastings WHERE tasting_id = $1 RETURNING observation_id', [tastingId]);
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
  const t = await editable(db, userId, tastingId);
  if (!t) return null;
  if (t.kind !== 'cellar') return 'not_cellar';
  const hasNotes = t.rating !== null || Boolean(t.notes?.trim()) || (Array.isArray(t.tags) && t.tags.length > 0);
  if (!hasNotes) {
    await deleteTasting(db, userId, tastingId);
    return { kept: false };
  }
  await db.query(`UPDATE tastings SET kind = 'tasted', bottles = NULL, cellar_id = NULL, updated_at = NOW() WHERE tasting_id = $1`, [tastingId]);
  await db.query('DELETE FROM cellar_slots WHERE tasting_id = $1', [tastingId]);
  return { kept: true };
}

/**
 * Tastings with the wine, what was paid (per 750 ml), and the market price
 * now for the same vintage (falling back to all vintages). Also every bottle
 * in the person's cellars, shared ones included: with which cellar, where it
 * sits on a rack, its receipt, who added it (when not them) and whether they
 * may change it.
 */
export async function listTastings(db: Db, userId: number, opts: { limit?: number; before?: number } = {}) {
  const { rows } = await db.query(
    `SELECT t.tasting_id, t.wine_id, w.display_name, w.producer, w.region, w.sub_region, w.country, w.colour, w.grape, w.wine_type, t.vintage_key,
            t.rating::float AS rating, t.notes, t.tags, t.price_paid_cents, t.price_context, t.bottle_ml, t.location,
            to_char(t.tasted_on, 'YYYY-MM-DD') AS tasted_on, t.kind, t.bottles, t.setting, w.image_url,
            t.cellar_id, t.receipt_id, COALESCE(m.role IN ('owner', 'editor'), t.user_id = $1) AS can_edit,
            CASE WHEN t.user_id <> $1 THEN (SELECT COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)) FROM users u WHERE u.user_id = t.user_id) END AS added_by,
            (SELECT json_agg(json_build_object('rackId', s.rack_id, 'rack', r.name, 'row', s.row_no, 'col', s.col_no) ORDER BY r.sort, s.row_no, s.col_no)
               FROM cellar_slots s JOIN cellar_racks r USING (rack_id) WHERE s.tasting_id = t.tasting_id) AS places,
            CASE WHEN t.price_paid_cents IS NULL THEN NULL ELSE round(t.price_paid_cents * 750.0 / t.bottle_ml)::int END AS paid_750_cents,
            COALESCE(pv.median_cents, pa.median_cents) AS market_now_cents,
            CASE WHEN pv.median_cents IS NOT NULL THEN t.vintage_key ELSE CASE WHEN pa.median_cents IS NOT NULL THEN '*' END END AS market_vintage_key
       FROM tastings t
       JOIN wines w USING (wine_id)
       LEFT JOIN wine_prices pv ON pv.wine_id = t.wine_id AND pv.vintage_key = t.vintage_key AND pv.currency = 'USD'
       LEFT JOIN wine_prices pa ON pa.wine_id = t.wine_id AND pa.vintage_key = '*' AND pa.currency = 'USD'
       LEFT JOIN cellar_members m ON m.cellar_id = t.cellar_id AND m.user_id = $1
      WHERE ((t.user_id = $1 AND (t.kind <> 'cellar' OR t.cellar_id IS NULL))
             OR t.cellar_id IN (SELECT cellar_id FROM cellar_members WHERE user_id = $1))
        AND ($2::bigint IS NULL OR t.tasting_id < $2)
      ORDER BY t.tasted_on DESC, t.tasting_id DESC
      LIMIT $3`,
    [userId, opts.before ?? null, Math.min(opts.limit ?? 50, 1000)]
  );
  return rows;
}
