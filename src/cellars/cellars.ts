/**
 * Cellars: where the bottles you own are kept. Everyone has at least one
 * (made when first needed); a cellar can be shared with a partner or a team
 * through an invite link. Members see every bottle in it; owners and editors
 * add, change and remove them, set where each sits on a rack, and file
 * receipts (src/cellars/receipts.ts). Only owners share, rename members'
 * roles, or delete the cellar.
 */
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/pool.js';

export type Role = 'owner' | 'editor' | 'viewer';
export const canEdit = (role: Role | null) => role === 'owner' || role === 'editor';

export class CellarError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function roleIn(db: Db, userId: number, cellarId: number): Promise<Role | null> {
  const { rows: [m] } = await db.query('SELECT role FROM cellar_members WHERE cellar_id = $1 AND user_id = $2', [cellarId, userId]);
  return (m?.role as Role) ?? null;
}

/** The role, or a 404 when not a member (so cellars stay invisible to others). */
async function need(db: Db, userId: number, cellarId: number, what: 'see' | 'edit' | 'own'): Promise<Role> {
  const role = await roleIn(db, userId, cellarId);
  if (!role) throw new CellarError(404, 'cellar not found');
  if (what === 'edit' && !canEdit(role)) throw new CellarError(403, 'You can look at this cellar but not change it.');
  if (what === 'own' && role !== 'owner') throw new CellarError(403, "Only the cellar's owners can do that.");
  return role;
}
export const needCellar = need;

export async function createCellar(db: Db, userId: number, name: string): Promise<number> {
  const { rows: [c] } = await db.query('INSERT INTO cellars (name, created_by) VALUES ($1, $2) RETURNING cellar_id', [name, userId]);
  await db.query(`INSERT INTO cellar_members (cellar_id, user_id, role) VALUES ($1, $2, 'owner')`, [c.cellar_id, userId]);
  return Number(c.cellar_id);
}

/**
 * Where new bottles go when no cellar is named: the first cellar the person
 * can add to (their own before shared ones), made now if there is none.
 */
export async function defaultCellar(db: Db, userId: number): Promise<number> {
  const { rows: [c] } = await db.query(
    `SELECT cellar_id FROM cellar_members WHERE user_id = $1 AND role IN ('owner', 'editor')
      ORDER BY role = 'owner' DESC, joined_at, cellar_id LIMIT 1`,
    [userId]
  );
  return c ? Number(c.cellar_id) : createCellar(db, userId, 'My cellar');
}

/** The cellar a new entry goes in: the one asked for (which they must be able to add to), else their default. */
export async function cellarForNew(db: Db, userId: number, cellarId?: number | null): Promise<number> {
  if (!cellarId) return defaultCellar(db, userId);
  await need(db, userId, cellarId, 'edit');
  return cellarId;
}

/**
 * The person's cellars with who's in each, what's in it (bottles, wines),
 * what it cost and what it's worth now (market median per 750 ml for the
 * vintage, else all vintages, scaled to the bottle size; bottles without a
 * market price count at what was paid, and are counted in `unpriced`). The
 * change in value compares like with like: paired* covers only bottles with
 * both a price paid and a market price.
 */
export async function listCellars(db: Db, userId: number) {
  await defaultCellar(db, userId);
  const { rows } = await db.query(
    `SELECT c.cellar_id, c.name, m.role, c.created_at,
            COALESCE(s.bottles, 0)::int AS bottles, COALESCE(s.wines, 0)::int AS wines,
            COALESCE(s.cost_cents, 0)::bigint::float8 AS cost_cents, COALESCE(s.value_cents, 0)::bigint::float8 AS value_cents,
            COALESCE(s.paired_cost_cents, 0)::bigint::float8 AS paired_cost_cents, COALESCE(s.paired_value_cents, 0)::bigint::float8 AS paired_value_cents,
            COALESCE(s.unpriced, 0)::int AS unpriced,
            (SELECT COUNT(*)::int FROM cellar_racks r WHERE r.cellar_id = c.cellar_id) AS racks,
            (SELECT COUNT(*)::int FROM receipts r WHERE r.cellar_id = c.cellar_id) AS receipts,
            (SELECT json_agg(json_build_object('userId', u.user_id, 'name', COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), 'role', cm.role, 'me', u.user_id = $1)
                             ORDER BY cm.role = 'owner' DESC, cm.joined_at)
               FROM cellar_members cm JOIN users u USING (user_id) WHERE cm.cellar_id = c.cellar_id) AS members
       FROM cellar_members m
       JOIN cellars c USING (cellar_id)
       LEFT JOIN LATERAL (
         SELECT SUM(t.bottles) AS bottles, COUNT(DISTINCT t.wine_id) AS wines,
                SUM(COALESCE(t.price_paid_cents, 0) * t.bottles) AS cost_cents,
                SUM(COALESCE(round(COALESCE(pv.median_cents, pa.median_cents) * t.bottle_ml / 750.0), t.price_paid_cents, 0) * t.bottles) AS value_cents,
                SUM(CASE WHEN COALESCE(pv.median_cents, pa.median_cents) IS NOT NULL AND t.price_paid_cents IS NOT NULL THEN t.price_paid_cents * t.bottles ELSE 0 END) AS paired_cost_cents,
                SUM(CASE WHEN t.price_paid_cents IS NOT NULL THEN round(COALESCE(pv.median_cents, pa.median_cents) * t.bottle_ml / 750.0) * t.bottles ELSE 0 END) AS paired_value_cents,
                SUM(CASE WHEN COALESCE(pv.median_cents, pa.median_cents) IS NULL THEN t.bottles ELSE 0 END) AS unpriced
           FROM tastings t
           LEFT JOIN wine_prices pv ON pv.wine_id = t.wine_id AND pv.vintage_key = t.vintage_key AND pv.currency = 'USD'
           LEFT JOIN wine_prices pa ON pa.wine_id = t.wine_id AND pa.vintage_key = '*' AND pa.currency = 'USD'
          WHERE t.cellar_id = c.cellar_id AND t.kind = 'cellar'
       ) s ON TRUE
      WHERE m.user_id = $1
      ORDER BY m.role = 'owner' DESC, m.joined_at, c.cellar_id`,
    [userId]
  );
  return rows.map((r) => ({
    cellarId: Number(r.cellar_id),
    name: r.name as string,
    role: r.role as Role,
    bottles: r.bottles as number,
    wines: r.wines as number,
    costCents: Number(r.cost_cents),
    valueCents: Number(r.value_cents),
    pairedCostCents: Number(r.paired_cost_cents),
    pairedValueCents: Number(r.paired_value_cents),
    unpriced: r.unpriced as number,
    racks: r.racks as number,
    receipts: r.receipts as number,
    members: (r.members ?? []) as { userId: number; name: string; role: Role; me: boolean }[],
  }));
}

export async function renameCellar(db: Db, userId: number, cellarId: number, name: string): Promise<void> {
  await need(db, userId, cellarId, 'edit');
  await db.query('UPDATE cellars SET name = $2 WHERE cellar_id = $1', [cellarId, name]);
}

/** Deleting a cellar: owners only, and only once it holds no bottles (they'd be lost). */
export async function deleteCellar(db: Db, userId: number, cellarId: number): Promise<void> {
  await need(db, userId, cellarId, 'own');
  const { rows: [n] } = await db.query(`SELECT COUNT(*)::int AS n FROM tastings WHERE cellar_id = $1 AND kind = 'cellar'`, [cellarId]);
  if (n.n) throw new CellarError(409, 'Move or remove its bottles first.');
  await db.query('DELETE FROM cellars WHERE cellar_id = $1', [cellarId]);
}

// ── Sharing ─────────────────────────────────────────────────────────────────

export async function createInvite(db: Db, userId: number, cellarId: number, role: 'editor' | 'viewer'): Promise<{ code: string; expiresAt: string }> {
  await need(db, userId, cellarId, 'own');
  // Unguessable, and short enough to read out: 10 characters, no look-alikes.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const code = [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
  const { rows: [i] } = await db.query(
    'INSERT INTO cellar_invites (code, cellar_id, role, created_by) VALUES ($1, $2, $3, $4) RETURNING expires_at',
    [code, cellarId, role, userId]
  );
  return { code, expiresAt: new Date(i.expires_at).toISOString() };
}

async function liveInvite(db: Db, code: string) {
  const { rows: [i] } = await db.query(
    `SELECT i.cellar_id, i.role, c.name, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1), '') AS from_name,
            i.used_at IS NOT NULL AS used, i.expires_at < NOW() AS expired
       FROM cellar_invites i JOIN cellars c USING (cellar_id) LEFT JOIN users u ON u.user_id = i.created_by
      WHERE i.code = $1`,
    [code.trim().toLowerCase()]
  );
  if (!i) throw new CellarError(404, "That invite link doesn't work. Ask for a new one.");
  if (i.used) throw new CellarError(410, 'That invite has been used. Ask for a new one.');
  if (i.expired) throw new CellarError(410, 'That invite has expired. Ask for a new one.');
  return i;
}

/** What an invite is for, before accepting it. */
export async function previewInvite(db: Db, userId: number, code: string) {
  const i = await liveInvite(db, code);
  return { cellarName: i.name as string, from: i.from_name as string, role: i.role as Role, member: Boolean(await roleIn(db, userId, i.cellar_id)) };
}

/** Join the cellar (someone already in it keeps their role). */
export async function acceptInvite(db: Db, userId: number, code: string): Promise<{ cellarId: number }> {
  const i = await liveInvite(db, code);
  const cellarId = Number(i.cellar_id);
  if (await roleIn(db, userId, cellarId)) return { cellarId };
  const { rowCount } = await db.query(
    'UPDATE cellar_invites SET used_by = $2, used_at = NOW() WHERE code = $1 AND used_at IS NULL',
    [code.trim().toLowerCase(), userId]
  );
  if (!rowCount) throw new CellarError(410, 'That invite has been used. Ask for a new one.');
  await db.query('INSERT INTO cellar_members (cellar_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [cellarId, userId, i.role]);
  return { cellarId };
}

/** An owner changes someone's role; there must always be an owner. */
export async function setMemberRole(db: Db, userId: number, cellarId: number, memberId: number, role: Role): Promise<void> {
  await need(db, userId, cellarId, 'own');
  const current = await roleIn(db, memberId, cellarId);
  if (!current) throw new CellarError(404, 'member not found');
  if (current === 'owner' && role !== 'owner') await keepAnOwner(db, cellarId, memberId);
  await db.query('UPDATE cellar_members SET role = $3 WHERE cellar_id = $1 AND user_id = $2', [cellarId, memberId, role]);
}

/** Leave a cellar, or (owners) take someone out of it. Their bottles stay in the cellar. */
export async function removeMember(db: Db, userId: number, cellarId: number, memberId: number): Promise<void> {
  if (memberId !== userId) await need(db, userId, cellarId, 'own');
  const current = await roleIn(db, memberId, cellarId);
  if (!current) throw new CellarError(404, 'member not found');
  if (current === 'owner') await keepAnOwner(db, cellarId, memberId);
  await db.query('DELETE FROM cellar_members WHERE cellar_id = $1 AND user_id = $2', [cellarId, memberId]);
}

async function keepAnOwner(db: Db, cellarId: number, leaving: number): Promise<void> {
  const { rows: [n] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM cellar_members WHERE cellar_id = $1 AND role = 'owner' AND user_id <> $2`,
    [cellarId, leaving]
  );
  if (!n.n) throw new CellarError(409, 'A cellar needs an owner. Make someone else an owner first.');
}

// ── Racks and places ────────────────────────────────────────────────────────

export interface RackInput { name: string; rows: number; cols: number }

export async function createRack(db: Db, userId: number, cellarId: number, r: RackInput): Promise<number> {
  await need(db, userId, cellarId, 'edit');
  const { rows: [x] } = await db.query(
    `INSERT INTO cellar_racks (cellar_id, name, n_rows, n_cols, sort)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort), -1) + 1 FROM cellar_racks WHERE cellar_id = $1)) RETURNING rack_id`,
    [cellarId, r.name, r.rows, r.cols]
  );
  return Number(x.rack_id);
}

async function rackCellar(db: Db, rackId: number): Promise<{ cellarId: number; rows: number; cols: number }> {
  const { rows: [r] } = await db.query('SELECT cellar_id, n_rows, n_cols FROM cellar_racks WHERE rack_id = $1', [rackId]);
  if (!r) throw new CellarError(404, 'rack not found');
  return { cellarId: Number(r.cellar_id), rows: r.n_rows, cols: r.n_cols };
}

/** Rename or resize a rack. Shrinking it can't strand bottles: their places must be cleared first. */
export async function updateRack(db: Db, userId: number, rackId: number, r: Partial<RackInput>): Promise<void> {
  const rack = await rackCellar(db, rackId);
  await need(db, userId, rack.cellarId, 'edit');
  const rows = r.rows ?? rack.rows, cols = r.cols ?? rack.cols;
  const { rows: [out] } = await db.query(
    'SELECT COUNT(*)::int AS n FROM cellar_slots WHERE rack_id = $1 AND (row_no >= $2 OR col_no >= $3)',
    [rackId, rows, cols]
  );
  if (out.n) throw new CellarError(409, `${out.n} bottle${out.n === 1 ? '' : 's'} would fall outside. Move ${out.n === 1 ? 'it' : 'them'} first.`);
  await db.query('UPDATE cellar_racks SET name = COALESCE($2, name), n_rows = $3, n_cols = $4 WHERE rack_id = $1', [rackId, r.name ?? null, rows, cols]);
}

/** Deleting a rack only forgets where its bottles were; the bottles stay in the cellar. */
export async function deleteRack(db: Db, userId: number, rackId: number): Promise<void> {
  const rack = await rackCellar(db, rackId);
  await need(db, userId, rack.cellarId, 'edit');
  await db.query('DELETE FROM cellar_racks WHERE rack_id = $1', [rackId]);
}

/** A cellar's racks, each with what sits where. */
export async function listRacks(db: Db, userId: number, cellarId: number) {
  await need(db, userId, cellarId, 'see');
  const { rows } = await db.query(
    `SELECT r.rack_id, r.name, r.n_rows, r.n_cols,
            COALESCE((SELECT json_agg(json_build_object(
                        'row', s.row_no, 'col', s.col_no, 'tastingId', s.tasting_id, 'wineId', t.wine_id, 'name', w.display_name,
                        'vintage', t.vintage_key, 'colour', w.colour, 'wineType', w.wine_type) ORDER BY s.row_no, s.col_no)
                        FROM cellar_slots s JOIN tastings t USING (tasting_id) JOIN wines w ON w.wine_id = t.wine_id
                       WHERE s.rack_id = r.rack_id), '[]') AS slots
       FROM cellar_racks r WHERE r.cellar_id = $1 ORDER BY r.sort, r.rack_id`,
    [cellarId]
  );
  return rows.map((r) => ({ rackId: Number(r.rack_id), name: r.name as string, rows: r.n_rows as number, cols: r.n_cols as number, slots: r.slots }));
}

/** The entry (a cellar bottle) and what the person may do with it. */
async function entry(db: Db, userId: number, tastingId: number) {
  const { rows: [t] } = await db.query('SELECT tasting_id, user_id, kind, bottles, cellar_id FROM tastings WHERE tasting_id = $1', [tastingId]);
  if (!t) throw new CellarError(404, 'tasting not found');
  if (t.kind !== 'cellar' || !t.cellar_id) {
    if (Number(t.user_id) !== userId) throw new CellarError(404, 'tasting not found');
    throw new CellarError(400, 'not a cellar entry');
  }
  await need(db, userId, Number(t.cellar_id), 'edit');
  return { cellarId: Number(t.cellar_id), bottles: Number(t.bottles ?? 1) };
}

export interface Place { rackId: number; row: number; col: number }

/**
 * Where an entry's bottles sit: replaces its places. One place per bottle at
 * most, on racks in the entry's cellar, inside the rack, and not taken by
 * another bottle.
 */
export async function setPlaces(db: Db, userId: number, tastingId: number, places: Place[]): Promise<void> {
  const e = await entry(db, userId, tastingId);
  if (places.length > e.bottles) throw new CellarError(400, `There ${e.bottles === 1 ? 'is 1 bottle' : `are ${e.bottles} bottles`}; that's ${places.length} places.`);
  const seen = new Set<string>();
  for (const p of places) {
    const rack = await rackCellar(db, p.rackId);
    if (rack.cellarId !== e.cellarId) throw new CellarError(400, 'That rack is in another cellar.');
    if (p.row >= rack.rows || p.col >= rack.cols) throw new CellarError(400, 'That place is outside the rack.');
    const k = `${p.rackId}:${p.row}:${p.col}`;
    if (seen.has(k)) throw new CellarError(400, 'The same place twice.');
    seen.add(k);
  }
  if (places.length) {
    const { rows: [taken] } = await db.query(
      `SELECT s.row_no, s.col_no FROM cellar_slots s JOIN unnest($1::bigint[], $2::int[], $3::int[]) AS p(rack_id, row_no, col_no)
          USING (rack_id, row_no, col_no)
        WHERE s.tasting_id <> $4 LIMIT 1`,
      [places.map((p) => p.rackId), places.map((p) => p.row), places.map((p) => p.col), tastingId]
    );
    if (taken) throw new CellarError(409, `Row ${taken.row_no + 1}, place ${taken.col_no + 1} already holds another bottle.`);
  }
  await db.query('DELETE FROM cellar_slots WHERE tasting_id = $1', [tastingId]);
  await db.query(
    `INSERT INTO cellar_slots (rack_id, row_no, col_no, tasting_id)
     SELECT rack_id, row_no, col_no, $4 FROM unnest($1::bigint[], $2::int[], $3::int[]) AS p(rack_id, row_no, col_no)`,
    [places.map((p) => p.rackId), places.map((p) => p.row), places.map((p) => p.col), tastingId]
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') throw new CellarError(409, 'Someone just put another bottle there.');
    throw err;
  });
}

/** After an entry's bottle count drops: keep the first places, one per bottle left. */
export async function trimPlaces(db: Db, tastingId: number, bottles: number): Promise<void> {
  await db.query(
    `DELETE FROM cellar_slots WHERE tasting_id = $1 AND (rack_id, row_no, col_no) NOT IN (
       SELECT rack_id, row_no, col_no FROM cellar_slots WHERE tasting_id = $1 ORDER BY rack_id, row_no, col_no LIMIT $2)`,
    [tastingId, Math.max(0, bottles)]
  );
}
