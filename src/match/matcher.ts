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
/**
 * A word in more than this share of the catalog is common ("valley" is in
 * 25k wines, "pinot" 20k): looking a wine up by every word on its line pulls
 * in tens of thousands of wines to rank (0.7 s for "Caymus Napa Valley
 * Cabernet Sauvignon"), by its uncommon words only a few dozen (1 ms).
 */
const COMMON_SHARE = 0.004;
/** How long the list of common words is kept before it is read again. */
const COMMON_WORDS_MS = 60 * 60_000;
let commonCache: { at: number; words: Promise<Set<string>> } | null = null;

/** Words in more than COMMON_SHARE of the catalog, from Postgres's statistics on wines.tokens (empty until it has some). */
function commonWords(db: Db): Promise<Set<string>> {
  if (commonCache && Date.now() - commonCache.at < COMMON_WORDS_MS) return commonCache.words;
  const words = db.query(
    `SELECT most_common_elems::text::text[] AS words, most_common_elem_freqs AS freqs FROM pg_stats WHERE tablename = 'wines' AND attname = 'tokens'`
  ).then(
    ({ rows: [r] }) => new Set<string>(((r?.words ?? []) as string[]).filter((_, i) => Number(r.freqs[i]) > COMMON_SHARE)),
    () => new Set<string>()
  );
  commonCache = { at: Date.now(), words };
  return words;
}

/** Forget the common words (tests). */
export function forgetCommonWords(): void {
  commonCache = null;
}

export interface MatchOptions {
  /** Only consider catalog wines from these sources (e.g. ['lwin']). */
  sources?: string[];
  /** Never return this wine (used when re-matching a wine against the rest of the catalog). */
  excludeWineId?: number;
  /** No typo tolerance (comparing catalog wines with each other). */
  exact?: boolean;
  /**
   * For text a model has already read cleanly, such as a wine list: skip the
   * whole-text trigram search (the slow path, for typos and OCR errors), and
   * search learned aliases (also by trigram, and most of a lookup's time)
   * only when the word lookup finds little.
   */
  noFuzzy?: boolean;
}

export async function findCandidates(db: Db, q: MatchQuery, opts: MatchOptions = {}): Promise<CandidateWine[]> {
  const text = normalize([q.producer, q.name, q.text].filter(Boolean).join(' '));
  if (!text) return [];
  const tokens = identityTokens(text);
  // Looked up by its uncommon words (not prices or bin numbers either), ranked by all of them;
  // by every word when it has no uncommon one, or they find little (a misspelt producer).
  const common = await commonWords(db);
  const rare = tokens.filter((t) => !common.has(t) && !/^\d+$/.test(t));
  const params = [text, tokens, CANDIDATE_LIMIT, opts.sources ?? null, opts.excludeWineId ?? 0, rare.length ? rare : tokens];
  // Indexed ways in, each capped, then unioned:
  //   * shared identity words (GIN on wines.tokens), most shared first,
  //     found by the uncommon ones
  //   * learned aliases (GIN trigram on alias_norm) - for noFuzzy text only
  //     when the word lookup finds little
  //   * whole-text trigram similarity (GIN on search_norm) - only when the
  //     word lookup finds little, i.e. typos/OCR errors; it is the slow path.
  const select = (ids: string) => `
     SELECT w.wine_id, w.producer, w.name, w.display_name, w.region, w.sub_region, w.country,
            w.colour, w.grape, w.classification, w.source,
            COALESCE((SELECT array_agg(a.alias_norm) FROM wine_aliases a WHERE a.wine_id = w.wine_id), '{}') AS aliases
       FROM (${ids}) ids JOIN wines w USING (wine_id)`;
  const filter = (t = 'wines') => `($4::text[] IS NULL OR ${t}.source = ANY($4)) AND ${t}.wine_id <> $5`;
  // (Each types all of $1-$3 and $6, so either can run on its own.)
  const byWords = `(SELECT wine_id FROM wines
        WHERE tokens && $6::text[] AND $1::text IS NOT NULL AND ${filter()}
        ORDER BY cardinality(ARRAY(SELECT unnest(tokens) INTERSECT SELECT unnest($2::text[]))) DESC LIMIT $3)`;
  const byAlias = `(SELECT a.wine_id FROM wine_aliases a JOIN wines w2 ON w2.wine_id = a.wine_id
        WHERE a.alias_norm % $1 AND $2::text[] IS NOT NULL AND $3::int > 0 AND $6::text[] IS NOT NULL AND ${filter('w2')}
        ORDER BY similarity(a.alias_norm, $1) DESC LIMIT 20)`;
  const { rows } = await db.query(select(opts.noFuzzy ? byWords : `${byWords} UNION ${byAlias}`), params);
  const add = (more: CandidateWine[]) => {
    const seen = new Set(rows.map((r) => r.wine_id));
    for (const r of more) if (!seen.has(r.wine_id)) rows.push(r);
  };
  if (rows.length < 5 && rare.length && rare.length < tokens.length) {
    add((await db.query(select(byWords), [...params.slice(0, 5), tokens])).rows);
  }
  if (rows.length < 5 && opts.noFuzzy) add((await db.query(select(byAlias), params)).rows);
  if (rows.length < 5 && !opts.noFuzzy) {
    add((await db.query(
      select(`SELECT wine_id FROM wines WHERE search_norm % $1 AND $2::text[] IS NOT NULL AND $6::text[] IS NOT NULL AND ${filter()} ORDER BY similarity(search_norm, $1) DESC LIMIT $3`),
      params
    )).rows);
  }
  return rows as CandidateWine[];
}

export async function matchWine(db: Db, q: MatchQuery, opts: MatchOptions = {}): Promise<MatchResult> {
  const candidates = scoreCandidates(q, await findCandidates(db, q, opts), { exact: opts.exact });
  return { outcome: decide(candidates), candidates };
}
