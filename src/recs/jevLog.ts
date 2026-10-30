/**
 * Whether Jev is right, for the admin only. Each time Jev is asked about a
 * wine for someone, its enjoyment level (0..4) is kept beside the fit's
 * chance (src/recs/fit.ts). Once they rate that wine, the report shows how
 * often each called it (enjoyed or not), and how often the fit was right when
 * Jev agreed with it and when it didn't. Nothing here reaches the app.
 */
import type { Db } from '../db/pool.js';
import { enjoyed, jevAgrees } from './fit.js';

export type JevContext = 'suggestions' | 'list' | 'shelf';
export interface JevCheck { wineId: number; p: number; jevScore: number; basis: number }

/** Keep the latest check per person, wine and place it was asked. Never fails the request it came from. */
export async function logJevChecks(db: Db, userId: number, context: JevContext, checks: JevCheck[]): Promise<void> {
  if (!checks.length) return;
  await db.query(
    `INSERT INTO jev_checks (user_id, wine_id, context, fit_p, jev_score, basis)
     SELECT $1, w, $2, p, j, b FROM unnest($3::bigint[], $4::real[], $5::real[], $6::int[]) AS x(w, p, j, b)
     ON CONFLICT (user_id, wine_id, context) DO UPDATE
       SET fit_p = EXCLUDED.fit_p, jev_score = EXCLUDED.jev_score, basis = EXCLUDED.basis, checked_at = NOW()`,
    [userId, context, checks.map((c) => c.wineId), checks.map((c) => c.p), checks.map((c) => c.jevScore), checks.map((c) => c.basis)]
  ).catch((err) => console.error('jev log failed:', err));
}

interface Tally { n: number; right: number }
const rate = (t: Tally) => (t.n ? Math.round((t.right / t.n) * 1000) / 1000 : null);

/**
 * Checks since `days` ago (default 90), for one person or everyone, and how
 * they held up against ratings given after the check.
 */
export async function jevReport(db: Db, opts: { userId?: number; days?: number; limit?: number } = {}) {
  const { rows } = await db.query(
    `SELECT c.user_id, c.wine_id, w.display_name, c.context, c.fit_p, c.jev_score, c.basis, c.checked_at,
            (SELECT t.rating::float FROM tastings t WHERE t.user_id = c.user_id AND t.wine_id = c.wine_id AND t.rating IS NOT NULL
               AND t.created_at >= c.checked_at ORDER BY t.created_at DESC LIMIT 1) AS rating_after,
            (SELECT avg(t.rating)::float FROM tastings t WHERE t.user_id = c.user_id AND t.rating IS NOT NULL) AS mean_rating
       FROM jev_checks c JOIN wines w USING (wine_id)
      WHERE ($1::bigint IS NULL OR c.user_id = $1) AND c.checked_at > NOW() - make_interval(days => $2)
      ORDER BY c.checked_at DESC`,
    [opts.userId ?? null, opts.days ?? 90]
  );
  const fit: Tally = { n: 0, right: 0 }, jev: Tally = { n: 0, right: 0 }, whenAgreed: Tally = { n: 0, right: 0 }, whenNot: Tally = { n: 0, right: 0 };
  let fitSq = 0, jevSq = 0, agreed = 0;
  const checks = rows.map((r) => {
    const p = Number(r.fit_p), j = Number(r.jev_score) / 4;
    const agrees = jevAgrees(p, Number(r.jev_score))!;
    if (agrees) agreed++;
    let outcome: 'enjoyed' | 'not enjoyed' | null = null;
    if (r.rating_after != null) {
      const y = enjoyed(r.rating_after, r.mean_rating ?? 3.5);
      outcome = y ? 'enjoyed' : 'not enjoyed';
      const fitRight = (p >= 0.5) === y, jevRight = (j >= 0.5) === y;
      fit.n++; if (fitRight) fit.right++;
      jev.n++; if (jevRight) jev.right++;
      const t = agrees ? whenAgreed : whenNot;
      t.n++; if (fitRight) t.right++;
      fitSq += (p - (y ? 1 : 0)) ** 2;
      jevSq += (j - (y ? 1 : 0)) ** 2;
    }
    return {
      userId: Number(r.user_id), wineId: Number(r.wine_id), wine: r.display_name as string, context: r.context as string,
      fitChance: Math.round(p * 100) / 100, jevScore: Number(r.jev_score), basis: r.basis as number, agrees,
      checkedAt: new Date(r.checked_at).toISOString(), ratingAfter: r.rating_after as number | null, outcome,
    };
  });
  return {
    checks: rows.length,
    agreementRate: rows.length ? Math.round((agreed / rows.length) * 1000) / 1000 : null,
    rated: fit.n,
    accuracy: { fit: rate(fit), jev: rate(jev), fitWhenJevAgreed: rate(whenAgreed), fitWhenJevDisagreed: rate(whenNot) },
    brier: { fit: fit.n ? Math.round((fitSq / fit.n) * 1000) / 1000 : null, jev: jev.n ? Math.round((jevSq / jev.n) * 1000) / 1000 : null },
    recent: checks.slice(0, opts.limit ?? 100),
  };
}
