/**
 * Catalog matcher: indexed candidate lookup in Postgres, then the pure
 * scorer in score.ts to rank them. Shared by label scans and price crawling.
 */
import type { Db } from '../db/pool.js';
import { identityTokens, normalize } from '../lib/normalize.js';
import { decide, scoreCandidates, type CandidateWine, type MatchOutcome, type MatchQuery, type ScoredCandidate } from './score.js';

export interface MatchResult {
  outcome: MatchOutcome;
  candidates: ScoredCandidate[];
}

const CANDIDATE_LIMIT = 40;

export interface MatchOptions {
  /** Only consider catalog wines from these sources (e.g. ['lwin']). */
  sources?: string[];
  /** Never return this wine (used when re-matching a wine against the rest of the catalog). */
  excludeWineId?: number;
}

export async function findCandidates(db: Db, q: MatchQuery, opts: MatchOptions = {}): Promise<CandidateWine[]> {
  const text = normalize([q.producer, q.name, q.text].filter(Boolean).join(' '));
  if (!text) return [];
  const tokens = identityTokens(text);
  const params = [text, tokens, CANDIDATE_LIMIT, opts.sources ?? null, opts.excludeWineId ?? 0];
  // Indexed ways in, each capped, then unioned:
  //   * shared identity words (GIN on wines.tokens), most shared first
  //   * learned aliases (GIN trigram on alias_norm)
  //   * whole-text trigram similarity (GIN on search_norm) - only when the
  //     word lookup finds little, i.e. typos/OCR errors; it is the slow path.
  const select = (ids: string) => `
     SELECT w.wine_id, w.producer, w.name, w.display_name, w.region, w.sub_region, w.country,
            w.colour, w.grape, w.classification, w.source,
            COALESCE((SELECT array_agg(a.alias_norm) FROM wine_aliases a WHERE a.wine_id = w.wine_id), '{}') AS aliases
       FROM (${ids}) ids JOIN wines w USING (wine_id)`;
  const filter = (t = 'wines') => `($4::text[] IS NULL OR ${t}.source = ANY($4)) AND ${t}.wine_id <> $5`;
  const { rows } = await db.query(
    select(`
      (SELECT wine_id FROM wines
        WHERE tokens && $2::text[] AND ${filter()}
        ORDER BY cardinality(ARRAY(SELECT unnest(tokens) INTERSECT SELECT unnest($2::text[]))) DESC LIMIT $3)
      UNION
      (SELECT a.wine_id FROM wine_aliases a JOIN wines w2 ON w2.wine_id = a.wine_id
        WHERE a.alias_norm % $1 AND ${filter('w2')}
        ORDER BY similarity(a.alias_norm, $1) DESC LIMIT 20)`),
    params
  );
  if (rows.length < 5) {
    const seen = new Set(rows.map((r) => r.wine_id));
    const more = await db.query(
      select(`SELECT wine_id FROM wines WHERE search_norm % $1 AND $2::text[] IS NOT NULL AND ${filter()} ORDER BY similarity(search_norm, $1) DESC LIMIT $3`),
      params
    );
    for (const r of more.rows) if (!seen.has(r.wine_id)) rows.push(r);
  }
  return rows as CandidateWine[];
}

export async function matchWine(db: Db, q: MatchQuery, opts: MatchOptions = {}): Promise<MatchResult> {
  const candidates = scoreCandidates(q, await findCandidates(db, q, opts));
  return { outcome: decide(candidates), candidates };
}
