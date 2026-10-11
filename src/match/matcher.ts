/**
 * Catalog matcher: trigram search in Postgres for candidates, then the pure
 * scorer in score.ts to rank them. Shared by label scans and price crawling.
 */
import type { Db } from '../db/pool.js';
import { producerNorm } from '../catalog/wines.js';
import { normalize } from '../lib/normalize.js';
import { decide, scoreCandidates, type CandidateWine, type MatchOutcome, type MatchQuery, type ScoredCandidate } from './score.js';

export interface MatchResult {
  outcome: MatchOutcome;
  candidates: ScoredCandidate[];
}

const CANDIDATE_LIMIT = 40;

export async function findCandidates(db: Db, q: MatchQuery): Promise<CandidateWine[]> {
  const text = normalize([q.producer, q.name, q.text].filter(Boolean).join(' '));
  if (!text) return [];
  const producer = q.producer ? producerNorm(q.producer) : '';
  // Three ways in: whole-text similarity, the catalog producer appearing
  // inside the query, and learned aliases. word_similarity(a, b) asks "does a
  // appear somewhere in b", which is right for a short producer inside a long
  // retailer title.
  const { rows } = await db.query(
    `WITH cand AS (
       SELECT wine_id, GREATEST(similarity(search_norm, $1), word_similarity(producer_norm, $1)) AS sim
         FROM wines
        WHERE search_norm % $1 OR producer_norm <% $1
              OR ($2 <> '' AND producer_norm % $2)
       UNION ALL
       SELECT wine_id, similarity(alias_norm, $1) AS sim
         FROM wine_aliases
        WHERE alias_norm % $1
     ),
     top AS (
       SELECT wine_id, MAX(sim) AS sim FROM cand GROUP BY wine_id ORDER BY MAX(sim) DESC LIMIT $3
     )
     SELECT w.wine_id, w.producer, w.name, w.display_name, w.region, w.sub_region, w.country,
            w.colour, w.grape, w.classification,
            COALESCE((SELECT array_agg(a.alias_norm) FROM wine_aliases a WHERE a.wine_id = w.wine_id), '{}') AS aliases
       FROM top JOIN wines w USING (wine_id)
      ORDER BY top.sim DESC`,
    [text, producer, CANDIDATE_LIMIT]
  );
  return rows as CandidateWine[];
}

export async function matchWine(db: Db, q: MatchQuery): Promise<MatchResult> {
  const candidates = scoreCandidates(q, await findCandidates(db, q));
  return { outcome: decide(candidates), candidates };
}
