/**
 * Community notes: what people thought of a wine, shared with everyone who
 * uses WineTracker - how much they liked it and whether it was ready to
 * drink, in words, never a score. Anyone signed in can read them, like them,
 * reply, report one (three reports hide it), and block someone (their notes
 * and replies disappear for the person who blocked them). People appear by the name
 * they choose to show (Settings), else their first name and initial; never
 * their email.
 */
import type { Db } from '../db/pool.js';

export type Reaction = 'loved' | 'liked' | 'okay' | 'not_for_me';
export type Maturity = 'too_young' | 'ready' | 'peak' | 'past_prime';
export const REACTIONS = ['loved', 'liked', 'okay', 'not_for_me'] as const;
export const MATURITIES = ['too_young', 'ready', 'peak', 'past_prime'] as const;
/** Reports that hide a note or reply until someone looks at it. */
export const HIDE_AFTER_REPORTS = 3;

export class CommunityError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * The name someone shows the community: the one they chose, else their first
 * name and last initial ("Rohan D."), else "A WineTracker member". As SQL over
 * a users row aliased `u`.
 */
export const PUBLIC_NAME = `COALESCE(NULLIF(u.public_name, ''),
  NULLIF(trim(split_part(trim(u.display_name), ' ', 1) || CASE WHEN trim(u.display_name) LIKE '% %'
    THEN ' ' || upper(left(regexp_replace(trim(u.display_name), '^.* ', ''), 1)) || '.' ELSE '' END), ''),
  'A WineTracker member')`;

/** A rating as a reaction, to start a shared note from. */
export const reactionFor = (rating: number | null | undefined): Reaction =>
  rating == null ? 'liked' : rating >= 4.5 ? 'loved' : rating >= 3.5 ? 'liked' : rating >= 2.5 ? 'okay' : 'not_for_me';

export interface NoteInput {
  wineId: number;
  vintage?: string | null;
  tastingId?: number | null;
  reaction: Reaction;
  maturity?: Maturity | null;
  body?: string;
}

const clean = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);

/** Share a note. From one of their tastings, it takes that wine and vintage, and replaces an earlier share of it. */
export async function shareNote(db: Db, userId: number, n: NoteInput): Promise<number> {
  let { wineId, vintage } = n;
  if (n.tastingId) {
    const { rows: [t] } = await db.query('SELECT wine_id, vintage_key FROM tastings WHERE tasting_id = $1 AND user_id = $2', [n.tastingId, userId]);
    if (!t) throw new CommunityError(404, 'tasting not found');
    wineId = Number(t.wine_id);
    vintage = t.vintage_key;
  }
  const { rows: [w] } = await db.query('SELECT 1 FROM wines WHERE wine_id = $1', [wineId]);
  if (!w) throw new CommunityError(404, 'wine not found');
  const { rows: [x] } = await db.query(
    `INSERT INTO community_notes (user_id, wine_id, vintage_key, tasting_id, reaction, maturity, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tasting_id) DO UPDATE SET reaction = EXCLUDED.reaction, maturity = EXCLUDED.maturity, body = EXCLUDED.body, updated_at = NOW()
     RETURNING note_id`,
    [userId, wineId, vintage ?? null, n.tastingId ?? null, n.reaction, n.maturity ?? null, clean(n.body)]
  );
  return Number(x.note_id);
}

export async function updateNote(db: Db, userId: number, noteId: number, p: { reaction?: Reaction; maturity?: Maturity | null; body?: string }): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE community_notes SET reaction = COALESCE($3, reaction), maturity = CASE WHEN $6 THEN $4 ELSE maturity END,
            body = COALESCE($5, body), updated_at = NOW()
      WHERE note_id = $1 AND user_id = $2`,
    [noteId, userId, p.reaction ?? null, p.maturity ?? null, p.body === undefined ? null : clean(p.body), p.maturity !== undefined]
  );
  if (!rowCount) throw new CommunityError(404, 'note not found');
}

/** Take a shared note down (the tasting it came from stays). */
export async function deleteNote(db: Db, userId: number, noteId: number): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM community_notes WHERE note_id = $1 AND user_id = $2', [noteId, userId]);
  if (!rowCount) throw new CommunityError(404, 'note not found');
}

/**
 * Notes, newest first: everyone's, one wine's, or one person's (their own
 * hidden ones included for them). `before`: a note id, for the next page.
 */
export async function listNotes(db: Db, viewer: number, opts: { wineId?: number; mine?: boolean; noteId?: number; before?: number; limit?: number } = {}) {
  const { rows } = await db.query(
    `SELECT n.note_id, n.user_id, ${PUBLIC_NAME} AS author, n.wine_id, w.display_name, w.region, w.sub_region, w.country, w.colour, w.wine_type, w.image_url,
            n.vintage_key, n.reaction, n.maturity, n.body, n.created_at, n.updated_at, n.hidden,
            COALESCE(pv.median_cents, pa.median_cents) AS median_cents,
            (SELECT COUNT(*)::int FROM community_notes o WHERE o.user_id = n.user_id AND NOT o.hidden) AS author_notes,
            (SELECT COUNT(*)::int FROM community_likes l WHERE l.note_id = n.note_id) AS likes,
            EXISTS (SELECT 1 FROM community_likes l WHERE l.note_id = n.note_id AND l.user_id = $1) AS liked,
            (SELECT COUNT(*)::int FROM community_replies r WHERE r.note_id = n.note_id AND NOT r.hidden) AS replies
       FROM community_notes n
       JOIN users u ON u.user_id = n.user_id
       JOIN wines w ON w.wine_id = n.wine_id
       LEFT JOIN wine_prices pv ON pv.wine_id = n.wine_id AND pv.vintage_key = n.vintage_key AND pv.currency = 'USD'
       LEFT JOIN wine_prices pa ON pa.wine_id = n.wine_id AND pa.vintage_key = '*' AND pa.currency = 'USD'
      WHERE (NOT n.hidden OR n.user_id = $1)
        AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE b.user_id = $1 AND b.blocked_id = n.user_id)
        AND ($2::bigint IS NULL OR n.wine_id = $2)
        AND (NOT $3 OR n.user_id = $1)
        AND ($4::bigint IS NULL OR n.note_id = $4)
        AND ($5::bigint IS NULL OR n.note_id < $5)
      ORDER BY n.note_id DESC
      LIMIT $6`,
    [viewer, opts.wineId ?? null, Boolean(opts.mine), opts.noteId ?? null, opts.before ?? null, Math.min(opts.limit ?? 20, 50)]
  );
  return rows.map((r) => ({
    noteId: Number(r.note_id),
    author: { name: r.author as string, notes: r.author_notes as number, me: Number(r.user_id) === viewer },
    wine: {
      wineId: Number(r.wine_id), displayName: r.display_name as string, region: (r.sub_region || r.region) as string, country: r.country as string,
      colour: r.colour as string, wineType: r.wine_type as string, imageUrl: (r.image_url ?? null) as string | null, medianCents: (r.median_cents ?? null) as number | null,
    },
    vintage: (r.vintage_key ?? null) as string | null,
    reaction: r.reaction as Reaction,
    maturity: (r.maturity ?? null) as Maturity | null,
    body: r.body as string,
    createdAt: new Date(r.created_at).toISOString(),
    edited: new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60_000,
    hidden: r.hidden as boolean,
    likes: r.likes as number,
    liked: r.liked as boolean,
    replies: r.replies as number,
  }));
}

async function visibleNote(db: Db, noteId: number, viewer: number): Promise<void> {
  const { rows: [n] } = await db.query('SELECT user_id, hidden FROM community_notes WHERE note_id = $1', [noteId]);
  if (!n || (n.hidden && Number(n.user_id) !== viewer)) throw new CommunityError(404, 'note not found');
}

export async function setLike(db: Db, userId: number, noteId: number, like: boolean): Promise<void> {
  await visibleNote(db, noteId, userId);
  if (like) await db.query('INSERT INTO community_likes (note_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [noteId, userId]);
  else await db.query('DELETE FROM community_likes WHERE note_id = $1 AND user_id = $2', [noteId, userId]);
}

export async function listReplies(db: Db, viewer: number, noteId: number) {
  await visibleNote(db, noteId, viewer);
  const { rows } = await db.query(
    `SELECT r.reply_id, r.user_id, ${PUBLIC_NAME} AS author, r.body, r.created_at
       FROM community_replies r JOIN users u ON u.user_id = r.user_id
      WHERE r.note_id = $1 AND (NOT r.hidden OR r.user_id = $2)
        AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE b.user_id = $2 AND b.blocked_id = r.user_id)
      ORDER BY r.created_at, r.reply_id`,
    [noteId, viewer]
  );
  return rows.map((r) => ({ replyId: Number(r.reply_id), author: { name: r.author as string, me: Number(r.user_id) === viewer }, body: r.body as string, createdAt: new Date(r.created_at).toISOString() }));
}

export async function reply(db: Db, userId: number, noteId: number, body: string): Promise<number> {
  await visibleNote(db, noteId, userId);
  const text = clean(body).slice(0, 600);
  if (!text) throw new CommunityError(400, 'Write something first.');
  const { rows: [r] } = await db.query('INSERT INTO community_replies (note_id, user_id, body) VALUES ($1, $2, $3) RETURNING reply_id', [noteId, userId, text]);
  return Number(r.reply_id);
}

export async function deleteReply(db: Db, userId: number, replyId: number): Promise<void> {
  // Their own reply, or any reply on their own note.
  const { rowCount } = await db.query(
    `DELETE FROM community_replies r USING community_notes n
      WHERE r.reply_id = $1 AND n.note_id = r.note_id AND (r.user_id = $2 OR n.user_id = $2)`,
    [replyId, userId]
  );
  if (!rowCount) throw new CommunityError(404, 'reply not found');
}

/** Report a note or reply (once per person); enough reports hide it. Your own can't be reported. */
export async function report(db: Db, userId: number, target: { noteId?: number; replyId?: number }, reason: string): Promise<void> {
  const table = target.noteId ? 'community_notes' : 'community_replies';
  const col = target.noteId ? 'note_id' : 'reply_id';
  const id = target.noteId ?? target.replyId!;
  const { rows: [x] } = await db.query(`SELECT user_id FROM ${table} WHERE ${col} = $1`, [id]);
  if (!x) throw new CommunityError(404, 'not found');
  if (Number(x.user_id) === userId) throw new CommunityError(400, "That's yours: delete it instead.");
  await db.query(`INSERT INTO community_reports (${col}, user_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, userId, reason.slice(0, 200)]);
  await db.query(
    `UPDATE ${table} SET hidden = TRUE WHERE ${col} = $1 AND (SELECT COUNT(*) FROM community_reports WHERE ${col} = $1) >= $2`,
    [id, HIDE_AFTER_REPORTS]
  );
}

/** Never see notes or replies from whoever wrote this note (or reply) again. */
export async function blockAuthor(db: Db, userId: number, target: { noteId?: number; replyId?: number }): Promise<void> {
  const { rows: [x] } = target.noteId
    ? await db.query('SELECT user_id FROM community_notes WHERE note_id = $1', [target.noteId])
    : await db.query('SELECT user_id FROM community_replies WHERE reply_id = $1', [target.replyId]);
  if (!x) throw new CommunityError(404, 'not found');
  if (Number(x.user_id) === userId) throw new CommunityError(400, "You can't block yourself.");
  await db.query('INSERT INTO community_blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, x.user_id]);
}

/** Unblock everyone (Settings). */
export async function unblockAll(db: Db, userId: number): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM community_blocks WHERE user_id = $1', [userId]);
  return rowCount ?? 0;
}
