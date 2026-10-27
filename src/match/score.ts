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
import { identityTokens, isYearOrSize, normalize, STOPWORDS, tokensMatch } from '../lib/normalize.js';

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
  source?: string;
  aliases?: string[];
}

export interface ScoredCandidate {
  wine: CandidateWine;
  score: number;
  detail: { producer: number; name: number; explained: number; colourConflict: boolean; via: 'catalog' | 'alias'; nameWords: number };
}

export interface ScoreOptions {
  /** No typo tolerance: for comparing two catalog wines, where both spellings are real names ("Marinus"/"Marius"). */
  exact?: boolean;
}

const CLASSIFICATION_TOKENS = [
  'grand', 'premier', '1er', 'cru', 'crus', 'classe', 'classes', 'superieur', 'exceptionnel', 'bourgeois',
  'deuxieme', 'troisieme', 'quatrieme', 'cinquieme', '2eme', '3eme', '4eme', '5eme', '2e', '3e', '4e', '5e',
];

function coverage(needles: string[], hay: string[], exact = false): number {
  if (!needles.length) return 1;
  let hit = 0;
  for (const n of needles) if (hay.some((h) => (exact ? n === h : tokensMatch(n, h)))) hit++;
  return hit / needles.length;
}

/** Tokens of a and b, plus joined pairs so "lynchbages" can match "lynch bages". */
export function withJoins(tokens: string[]): string[] {
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

/** Explicit style words in a title: rosé, white, sparkling. */
function marks(text: string) {
  const s = ` ${normalize(text)} `;
  return {
    rose: / (rose|rosado|rosato|rosa) /.test(s),
    white: / (blanc|bianco|blanco|white|weiss|weisser) /.test(s),
    sparkling: / (brut|sparkling|cremant|spumante|cava|prosecco|champagne|sekt|frizzante|petillant|pet nat|franciacorta) /.test(s),
    grapeColour: colourFromGrape(s.trim()),
    red: / (rouge|rosso|tinto|red) /.test(s),
  };
}

/**
 * Style conflict between two shop-style titles. Titles of rosé, white and
 * sparkling wines say so, so a mark on one side only means a different wine
 * - unless the other side names a grape that already implies it.
 */
function titleStyleConflict(a: string, b: string): boolean {
  const x = marks(a);
  const y = marks(b);
  if (x.rose !== y.rose) return true;
  if (x.white !== y.white) {
    const plain = x.white ? y : x;
    if (plain.grapeColour !== 'white') return true;
  }
  if (x.sparkling !== y.sparkling) {
    const still = x.sparkling ? y : x;
    if (still.grapeColour || still.red || still.white) return true;
  }
  return false;
}

function scoreOne(q: MatchQuery, qTokens: string[], c: CandidateWine, nameText: string, via: 'catalog' | 'alias', opts: ScoreOptions): ScoredCandidate {
  const qHay = withJoins(qTokens);
  const cover = (needles: string[], hay: string[]) => coverage(needles, hay, opts.exact);
  const prodTokens = identityTokens(c.producer);
  const placeTokens = identityTokens(`${c.region} ${c.sub_region} ${c.country}`);
  // A wine with no name of its own is shown as producer + appellation
  // ("Chateau La Conseillante, Pomerol"). For a Bordeaux chateau the
  // appellation is description; for "Coche-Dury, Bourgogne Aligote" it is
  // the wine. So it may be left out only when the query names no part of it,
  // and then grape words in the query must be explained too ("Guido Marsella
  // Falanghina" is not "Guido Marsella, Fiano di Avellino").
  const placeOptional = via === 'catalog' && !c.name && placeTokens.length > 0 && !placeTokens.some((t) => qHay.includes(t));
  // Classification is description too: LWIN names a main wine "Chateau du
  // Tertre 5eme Cru Classe, Margaux"; shops say "Chateau du Tertre".
  const ownPlaces = via === 'catalog' && !c.name
    ? [...(placeOptional ? placeTokens : []), ...CLASSIFICATION_TOKENS, ...identityTokens(c.classification)]
    : [];
  // Broad places ("Santa Cruz Mountains", "Wairarapa") are description, not identity.
  const nameTokens = identityTokens(nameText).filter((t) => !prodTokens.includes(t) && !isBroadPlaceToken(t) && !ownPlaces.includes(t));

  // Producer: if the catalog producer is all stopwords ("Chateau Latour" ->
  // ["latour"] is fine; "Domaine" alone -> []), fall back to the display name.
  let producer = prodTokens.length ? cover(prodTokens, qHay) : cover(identityTokens(c.display_name), qHay);
  const name = cover(nameTokens, qHay);

  // Brand-led wines: bottles and shop titles often say "Whispering Angel" or
  // "Sassicaia 2019" without the producer. A fully matched name counts as
  // identity when it is distinctive - not just grape or place words.
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
  // Catalog (LWIN/user) wines often don't record a grape, so grape words in
  // the query are neutral for them. Shop-created wines carry the grape in
  // their title, so for those a grape is identity ("Silver Gate Chardonnay"
  // is not "Silver Gate Brut").
  const shopTitled = c.source === 'crawl' || c.source === 'llm';
  const judged = qTokens.filter((t) => !isBroadPlaceToken(t) && (c.grape || shopTitled || placeOptional || !isGrapeToken(t)));
  const explained = judged.length ? cover(judged, explainers) : 1;

  const qColour = q.colour || colourOf(q.text);
  const cColour = c.colour || colourOf(`${c.display_name} ${c.name}`);
  // Rosés say so on the label and in shop titles; a query that doesn't is not the rosé.
  const roseUnsaid = cColour === 'rose' && !q.colour && !marks(`${q.producer ?? ''} ${q.name ?? ''} ${q.text}`).rose;
  const colourConflict =
    Boolean(qColour && cColour && qColour !== cColour) ||
    roseUnsaid ||
    (shopTitled && titleStyleConflict(q.text, nameText === c.name ? c.display_name : nameText));

  let score = 0.4 * producer + 0.3 * name + 0.3 * explained;
  if (producer === 0) score = Math.min(score, 0.35);   // never trust a match without the producer
  // Auto-matching needs complete two-way agreement: every identity word of the
  // wine is in the query and every word of the query is explained by the wine.
  // "Chevillon NSG Les Cailles" vs "Chevillon NSG Perrieres" differs both ways
  // (a sibling wine); "Colin Chassagne 1er Cru Les Chaumees" vs "Colin
  // Chassagne" differs one way (a more specific wine). Neither may auto-match.
  // A wine known only by grape/place words ("Pinot Noir") identifies nothing.
  const identity = [...prodTokens, ...nameTokens].filter((t) => !isGrapeToken(t) && !isBroadPlaceToken(t));
  const complete = name === 1 && (producer === 1 || brandLed) && identity.length > 0;
  if (explained < 1 && !complete) score = Math.min(score, 0.6);
  else if (explained < 1 || !complete) score = Math.min(score, THRESHOLDS.auto - 0.01);
  if (colourConflict) score -= 0.3;
  return { wine: c, score: Math.max(0, Math.min(1, score)), detail: { producer, name, explained, colourConflict, via, nameWords: name === 1 ? nameTokens.filter((t) => !placeTokens.includes(t)).length : 0 } };
}

export function scoreCandidates(q: MatchQuery, candidates: CandidateWine[], opts: ScoreOptions = {}): ScoredCandidate[] {
  const qTokens = identityTokens([q.producer, q.name, q.text].filter(Boolean).join(' '));
  const scored = candidates.map((c) => {
    let best = scoreOne(q, qTokens, c, c.name || c.display_name, 'catalog', opts);
    // An alias is a full alternative title for the wine, so score it as the "name".
    for (const alias of c.aliases ?? []) {
      const s = scoreOne(q, qTokens, c, alias, 'alias', opts);
      if (s.score > best.score) best = s;
    }
    return best;
  });
  // Ties: prefer the wine whose own name words are all in the query - for
  // "Duo de Conseillante Pomerol", the second wine over the grand vin. Then,
  // between copies of one wine, the catalog (LWIN) entry, else the oldest.
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.detail.nameWords - a.detail.nameWords ||
      Number(b.wine.source === 'lwin') - Number(a.wine.source === 'lwin') ||
      a.wine.wine_id - b.wine.wine_id
  );
}

/**
 * Entries that are copies of one wine share this key: every word of the
 * display name except years, bottle sizes and stopwords, in any order. Style
 * words stay ("Brut" vs "Vintage Brut" vs "Brut Rose" are different wines).
 * Shop-created copies all carry the shop's title, so they agree exactly.
 * Generic names ("Pinot Noir", "Napa Valley Red") get no key, because
 * different producers' wines are titled that way.
 */
export function twinKey(w: Pick<CandidateWine, 'display_name'>): string | null {
  const ident = identityTokens(w.display_name);
  if (!ident.length || ident.every((t) => isGrapeToken(t) || isBroadPlaceToken(t))) return null;
  const words = new Set(normalize(w.display_name).split(' ').filter((t) => t && !STOPWORDS.has(t) && !isYearOrSize(t)));
  return [...words].sort().join(' ');
}

export type MatchOutcome = 'auto' | 'choose' | 'new';

export const THRESHOLDS = { auto: 0.85, autoMargin: 0.08, choose: 0.5 };

/**
 * auto:   confident single match - attach without asking.
 * choose: plausible matches - show the top few to a person.
 * new:    nothing close - offer to create a new wine.
 */
export function decide(scored: ScoredCandidate[]): MatchOutcome {
  const [first] = scored;
  if (!first || first.score < THRESHOLDS.choose) return 'new';
  // Copies of the leading wine are not rivals: measure the margin to the best
  // different wine. (Otherwise two copies tie, the crawl creates a third, and so on.)
  const key = twinKey(first.wine);
  const second = scored.slice(1).find((c) => !key || twinKey(c.wine) !== key);
  const margin = first.score - (second?.score ?? 0);
  if (first.score >= THRESHOLDS.auto && margin >= THRESHOLDS.autoMargin) return 'auto';
  return 'choose';
}
