/**
 * Your taste, as a card: the flavors someone leans to and away from, the
 * styles they drink, what they usually spend, grapes and places they like,
 * and favorite bottles - from their ratings, the taste quiz and their own
 * edits (src/recs/recommend.ts, applyTasteEdits). It can be shared by link;
 * whoever opens it can add them as a friend, and friends see how alike their
 * palates are: the flavors both lean to, wines both loved, and what one
 * loves that the other hasn't tried.
 */
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { PUBLIC_NAME } from '../community/community.js';
import { FLAVOR_KEYS, flavorLabel, type Flavor } from './flavors.js';
import type { RecStyle } from './features.js';
import { loadPrefs, type Budget } from './archetypes.js';
import { loadProfile } from './recommend.js';

export class TasteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export interface TasteCard {
  name: string;
  rated: number;
  /** Flavor families leaned to, strongest first, with how strongly (0..1); and away from. */
  likes: { key: string; label: string; strength: number }[];
  dislikes: { key: string; label: string }[];
  styles: RecStyle[];
  priceLowCents: number | null;
  priceHighCents: number | null;
  grapes: string[];
  places: string[];
  /** Bottles they rated highest (4.5 and up first). */
  favorites: { wineId: number; name: string; vintage: string | null }[];
  /** Their own edits, for the editor. */
  edits: { likedFlavors: string[]; dislikedFlavors: string[]; avoid: string[]; budget: Budget | null; budgetFixed: boolean; styles: RecStyle[] };
}

export async function tasteCard(db: Db, userId: number): Promise<TasteCard> {
  const [{ profile, styles }, prefs, { rows: [u] }, { rows: favs }] = await Promise.all([
    loadProfile(db, userId),
    loadPrefs(db, userId),
    db.query(`SELECT ${PUBLIC_NAME} AS name FROM users u WHERE u.user_id = $1`, [userId]),
    db.query(
      `SELECT DISTINCT ON (t.wine_id) t.wine_id, w.display_name, t.vintage_key, t.rating::float AS rating
         FROM tastings t JOIN wines w USING (wine_id) WHERE t.user_id = $1 AND t.rating >= 4
        ORDER BY t.wine_id, t.rating DESC, t.tasted_on DESC`,
      [userId]
    ),
  ]);
  const flavors = [...profile.flavors.entries()];
  const top = flavors.filter(([, s]) => s.weight > 0).sort((a, b) => b[1].weight - a[1].weight).slice(0, 6);
  const max = top[0]?.[1].weight ?? 1;
  const liked = (k: 'grape' | 'appellation' | 'region' | 'country', n: number) =>
    [...profile.features[k].entries()].filter(([, s]) => s.weight > 0.05 && (s.liked > 0 || s.said > 0)).sort((a, b) => b[1].weight - a[1].weight).slice(0, n).map(([v]) => title(v));
  const band = profile.price ? [Math.exp(profile.price.mu - profile.price.sigma), Math.exp(profile.price.mu + profile.price.sigma)] : null;
  const round = (c: number) => Math.round(c / 500) * 500;
  return {
    name: u?.name ?? '',
    rated: profile.n,
    likes: top.map(([k, s]) => ({ key: k, label: flavorLabel(k), strength: Math.round(Math.min(1, s.weight / max) * 100) / 100 })),
    dislikes: flavors.filter(([, s]) => s.weight < -0.05).sort((a, b) => a[1].weight - b[1].weight).slice(0, 3).map(([k]) => ({ key: k, label: flavorLabel(k) })),
    styles,
    priceLowCents: band ? round(band[0]!) : null,
    priceHighCents: band ? round(band[1]!) : null,
    grapes: liked('grape', 4),
    places: [...new Set([...liked('appellation', 2), ...liked('region', 3)])].slice(0, 4),
    favorites: favs.sort((a, b) => b.rating - a.rating).slice(0, 5).map((f) => ({ wineId: Number(f.wine_id), name: f.display_name, vintage: f.vintage_key })),
    edits: { likedFlavors: prefs.likedFlavors, dislikedFlavors: prefs.dislikedFlavors, avoid: prefs.avoid, budget: prefs.budget, budgetFixed: prefs.budgetFixed, styles: prefs.styles },
  };
}

// ── Sharing ─────────────────────────────────────────────────────────────────

/** Their card's link code, made the first time (or anew, to revoke the old one). */
export async function cardCode(db: Db, userId: number, renew = false): Promise<string> {
  const code = randomBytes(9).toString('base64url');
  const { rows: [r] } = await db.query(
    `INSERT INTO taste_cards (user_id, code) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET code = CASE WHEN $3 THEN EXCLUDED.code ELSE taste_cards.code END, created_at = CASE WHEN $3 THEN NOW() ELSE taste_cards.created_at END
     RETURNING code`,
    [userId, code, renew]
  );
  return r.code;
}

async function ownerOf(db: Db, code: string): Promise<number> {
  const { rows: [r] } = await db.query('SELECT user_id FROM taste_cards WHERE code = $1', [code]);
  if (!r) throw new TasteError(404, "That taste card link doesn't work any more. Ask for a new one.");
  return Number(r.user_id);
}

export async function addFriend(db: Db, userId: number, code: string): Promise<number> {
  const friend = await ownerOf(db, code);
  if (friend === userId) throw new TasteError(400, "That's your own card.");
  await db.query('INSERT INTO taste_friends (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [userId, friend]);
  return friend;
}

export async function removeFriend(db: Db, userId: number, friendId: number): Promise<void> {
  await db.query('DELETE FROM taste_friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [userId, friendId]);
}

const isFriend = async (db: Db, a: number, b: number) =>
  Boolean((await db.query('SELECT 1 FROM taste_friends WHERE user_id = $1 AND friend_id = $2', [a, b])).rows[0]);

// ── Alike ───────────────────────────────────────────────────────────────────

/** Ratings each needs before two tastes are compared. */
export const MIN_TO_COMPARE = 3;

export interface Comparison {
  /** 0..100: how alike the two palates lean (flavors most, then styles and grapes); null until both have rated MIN_TO_COMPARE. */
  similarity: number | null;
  /** Flavors both lean to. */
  shared: string[];
  /** Wines both rated 4 or more. */
  bothLoved: { wineId: number; name: string }[];
  /** Wines they rated 4.5 or more that you haven't tasted. */
  theyLoveYouHavent: { wineId: number; name: string; vintage: string | null }[];
}

export async function compare(db: Db, me: number, them: number): Promise<Comparison> {
  const [a, b] = await Promise.all([loadProfile(db, me), loadProfile(db, them)]);
  const vec = (p: typeof a.profile) => FLAVOR_KEYS.map((k) => p.flavors.get(k as Flavor)?.weight ?? 0);
  const va = vec(a.profile), vb = vec(b.profile);
  const dot = va.reduce((s, x, i) => s + x * vb[i]!, 0);
  const norm = Math.sqrt(va.reduce((s, x) => s + x * x, 0) * vb.reduce((s, x) => s + x * x, 0));
  const flavor = norm ? (dot / norm + 1) / 2 : 0.5;
  const jaccard = (x: string[], y: string[]) => (x.length || y.length ? x.filter((v) => y.includes(v)).length / new Set([...x, ...y]).size : 0.5);
  const grapes = (p: typeof a.profile) => [...p.features.grape.entries()].filter(([, s]) => s.weight > 0).map(([g]) => g);
  const enough = a.profile.n >= MIN_TO_COMPARE && b.profile.n >= MIN_TO_COMPARE;
  const similarity = enough ? Math.round(100 * (0.65 * flavor + 0.2 * jaccard(a.styles, b.styles) + 0.15 * jaccard(grapes(a.profile), grapes(b.profile)))) : null;
  const shared = FLAVOR_KEYS.filter((k) => (a.profile.flavors.get(k as Flavor)?.weight ?? 0) > 0.05 && (b.profile.flavors.get(k as Flavor)?.weight ?? 0) > 0.05)
    .sort((x, y) => (b.profile.flavors.get(y as Flavor)!.weight + a.profile.flavors.get(y as Flavor)!.weight) - (b.profile.flavors.get(x as Flavor)!.weight + a.profile.flavors.get(x as Flavor)!.weight))
    .slice(0, 4).map(flavorLabel);
  const { rows: both } = await db.query(
    `SELECT w.wine_id, w.display_name FROM wines w
      WHERE EXISTS (SELECT 1 FROM tastings t WHERE t.wine_id = w.wine_id AND t.user_id = $1 AND t.rating >= 4)
        AND EXISTS (SELECT 1 FROM tastings t WHERE t.wine_id = w.wine_id AND t.user_id = $2 AND t.rating >= 4)
      LIMIT 10`,
    [me, them]
  );
  const { rows: theirs } = await db.query(
    `SELECT DISTINCT ON (t.wine_id) t.wine_id, w.display_name, t.vintage_key FROM tastings t JOIN wines w USING (wine_id)
      WHERE t.user_id = $2 AND t.rating >= 4.5 AND NOT EXISTS (SELECT 1 FROM tastings m WHERE m.user_id = $1 AND m.wine_id = t.wine_id)
      ORDER BY t.wine_id, t.rating DESC LIMIT 8`,
    [me, them]
  );
  return {
    similarity,
    shared,
    bothLoved: both.map((r) => ({ wineId: Number(r.wine_id), name: r.display_name })),
    theyLoveYouHavent: theirs.map((r) => ({ wineId: Number(r.wine_id), name: r.display_name, vintage: r.vintage_key })),
  };
}

/** Someone's card by its link, and how it compares with the viewer's; whether they're friends already. */
export async function cardByCode(db: Db, viewer: number, code: string) {
  const owner = await ownerOf(db, code);
  const card = await tasteCard(db, owner);
  const { edits: _edits, ...shown } = card;
  return { userId: owner, me: owner === viewer, friend: await isFriend(db, viewer, owner), card: shown, comparison: owner === viewer ? null : await compare(db, viewer, owner) };
}

/** A friend's card and comparison (friends only). */
export async function friendCard(db: Db, viewer: number, friendId: number) {
  if (!(await isFriend(db, viewer, friendId))) throw new TasteError(404, 'not found');
  const { edits: _edits, ...shown } = await tasteCard(db, friendId);
  return { userId: friendId, me: false, friend: true, card: shown, comparison: await compare(db, viewer, friendId) };
}

/** Friends, most alike first. */
export async function listFriends(db: Db, userId: number) {
  const { rows } = await db.query(
    `SELECT f.friend_id, ${PUBLIC_NAME} AS name FROM taste_friends f JOIN users u ON u.user_id = f.friend_id WHERE f.user_id = $1 ORDER BY f.created_at`,
    [userId]
  );
  const out = [];
  for (const r of rows) out.push({ userId: Number(r.friend_id), name: r.name as string, similarity: (await compare(db, userId, Number(r.friend_id))).similarity });
  return out.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
}
