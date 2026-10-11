/**
 * Pure scoring of "how well does this catalog wine explain this query".
 * No DB access, so it is unit-tested and eval-tested directly.
 *
 * The query is whatever we know about a bottle: a retailer title, or the
 * fields a vision model read off a label. A candidate is a catalog wine.
 *
 * Score in [0, 1], built from three questions:
 *   1. Does the query contain the candidate's producer?      (most important)
 *   2. Does the query contain the candidate's wine name?
 *   3. Is everything in the query explained by the candidate? (penalizes
 *      picking the producer's flagship when the bottle says "Reserve")
 */
import { colourFromGrape, isGrapeToken } from '../lib/grapes.js';
import { isBroadPlaceToken } from '../lib/places.js';
import { identityTokens, normalize, tokensMatch } from '../lib/normalize.js';

export interface MatchQuery {
  text: string;               // full text: title, or label fields joined
  producer?: string;
  name?: string;
  colour?: string;            // red | white | rose
}

export interface CandidateWine {
  wine_id: number;
  producer: string;
  name: string;
  display_name: string;
  region: string;
  sub_region: string;
  country: string;
  colour: string;
  grape: string;
  classification: string;
  aliases?: string[];
}

export interface ScoredCandidate {
  wine: CandidateWine;
  score: number;
  detail: { producer: number; name: number; explained: number; colourConflict: boolean; via: 'catalog' | 'alias' };
}

function coverage(needles: string[], hay: string[]): number {
  if (!needles.length) return 1;
  let hit = 0;
  for (const n of needles) if (hay.some((h) => tokensMatch(n, h))) hit++;
  return hit / needles.length;
}

/** Tokens of a and b, plus joined pairs so "lynchbages" can match "lynch bages". */
function withJoins(tokens: string[]): string[] {
  const out = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(tokens[i]! + tokens[i + 1]!);
  return out;
}

function colourOf(text: string): string {
  const s = ` ${normalize(text)} `;
  if (/ (rose|rosado|rosato) /.test(s)) return 'rose';
  if (/ (blanc|bianco|blanco|white|weiss) /.test(s)) return 'white';
  if (/ (rouge|rosso|tinto|red) /.test(s)) return 'red';
  return colourFromGrape(s.trim());
}

function scoreOne(q: MatchQuery, qTokens: string[], c: CandidateWine, nameText: string, via: 'catalog' | 'alias'): ScoredCandidate {
  const qHay = withJoins(qTokens);
  const prodTokens = identityTokens(c.producer);
  // Broad places ("Santa Cruz Mountains", "Wairarapa") are description, not identity.
  const nameTokens = identityTokens(nameText).filter((t) => !prodTokens.includes(t) && !isBroadPlaceToken(t));

  // Producer: if the catalog producer is all stopwords ("Chateau Latour" ->
  // ["latour"] is fine; "Domaine" alone -> []), fall back to the display name.
  let producer = prodTokens.length ? coverage(prodTokens, qHay) : coverage(identityTokens(c.display_name), qHay);
  const name = coverage(nameTokens, qHay);

  // Brand-led wines: bottles and shop titles often say "Whispering Angel" or
  // "Sassicaia 2019" without the producer. A fully matched name counts as
  // identity when it is distinctive - not just grape or place words.
  const placeTokens = identityTokens(`${c.region} ${c.sub_region} ${c.country}`);
  const brand = nameTokens.filter((t) => !isGrapeToken(t) && !placeTokens.includes(t));
  const distinctive = brand.length >= 2 || (brand.length === 1 && brand[0]!.length >= 6);
  const brandLed = producer < 0.5 && name === 1 && distinctive;
  if (brandLed) producer = Math.max(producer, 0.75);

  // Everything the candidate can account for: identity + place + grape words.
  const explainers = withJoins([
    ...prodTokens,
    ...nameTokens,
    ...identityTokens(c.display_name),
    ...identityTokens(`${c.region} ${c.sub_region} ${c.country} ${c.grape} ${c.classification}`),
  ]);
  // Grape words in the query are neutral when the catalog doesn't record a grape.
  const judged = qTokens.filter((t) => !isBroadPlaceToken(t) && (c.grape || !isGrapeToken(t)));
  const explained = judged.length ? coverage(judged, explainers) : 1;

  const qColour = q.colour || colourOf(q.text);
  const cColour = c.colour || colourOf(`${c.display_name} ${c.name}`);
  const colourConflict = Boolean(qColour && cColour && qColour !== cColour);

  let score = 0.4 * producer + 0.3 * name + 0.3 * explained;
  if (producer === 0) score = Math.min(score, 0.35);   // never trust a match without the producer
  // Auto-matching needs complete two-way agreement: every identity word of the
  // wine is in the query and every word of the query is explained by the wine.
  // "Chevillon NSG Les Cailles" vs "Chevillon NSG Perrieres" differs both ways
  // (a sibling wine); "Colin Chassagne 1er Cru Les Chaumees" vs "Colin
  // Chassagne" differs one way (a more specific wine). Neither may auto-match.
  const complete = name === 1 && (producer === 1 || brandLed);
  if (explained < 1 && !complete) score = Math.min(score, 0.6);
  else if (explained < 1 || !complete) score = Math.min(score, THRESHOLDS.auto - 0.01);
  if (colourConflict) score -= 0.3;
  return { wine: c, score: Math.max(0, Math.min(1, score)), detail: { producer, name, explained, colourConflict, via } };
}

export function scoreCandidates(q: MatchQuery, candidates: CandidateWine[]): ScoredCandidate[] {
  const qTokens = identityTokens([q.producer, q.name, q.text].filter(Boolean).join(' '));
  const scored = candidates.map((c) => {
    let best = scoreOne(q, qTokens, c, c.name || c.display_name, 'catalog');
    // An alias is a full alternative title for the wine, so score it as the "name".
    for (const alias of c.aliases ?? []) {
      const s = scoreOne(q, qTokens, c, alias, 'alias');
      if (s.score > best.score) best = s;
    }
    return best;
  });
  return scored.sort((a, b) => b.score - a.score);
}

export type MatchOutcome = 'auto' | 'choose' | 'new';

export const THRESHOLDS = { auto: 0.85, autoMargin: 0.08, choose: 0.5 };

/**
 * auto:   confident single match - attach without asking.
 * choose: plausible matches - show the top few to a person.
 * new:    nothing close - offer to create a new wine.
 */
export function decide(scored: ScoredCandidate[]): MatchOutcome {
  const [first, second] = scored;
  if (!first || first.score < THRESHOLDS.choose) return 'new';
  const margin = first.score - (second?.score ?? 0);
  if (first.score >= THRESHOLDS.auto && margin >= THRESHOLDS.autoMargin) return 'auto';
  return 'choose';
}
