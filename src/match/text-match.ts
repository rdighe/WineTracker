/**
 * Match free OCR text of a label to the catalog, without an LLM.
 *
 * Label text is mostly noise for identity ("mis en bouteille au chateau",
 * "13.5% vol", owners' names), so the usual "everything in the query must be
 * explained" rule can't apply. Instead a wine fits when ALL of its producer and
 * name words appear on the label. It is only trusted when it is the single
 * most specific fit: "Echo de Lynch-Bages" beats "Lynch-Bages" only when
 * "Echo" is on the label, and two fits that differ only by appellation need
 * the appellation on the label. A grape or colour word the wine can't account
 * for ("Caymus" + "Zinfandel" when only Caymus Cabernet is known) blocks it.
 * Anything short of that is 'unsure', and the caller falls back to the LLM.
 *
 * Second stage, for garbled OCR ("ACONSELANTE"): a long word may stand for a
 * producer/name word it is close to (edit distance <= 30% of its length), but
 * only when the label also prints the wine's appellation exactly ("POMEROL")
 * and no other wine is corroborated the same way. Similarity alone is not
 * enough: "aconselante" is nearly as close to Napa's "Alante".
 */
import type { Db } from '../db/pool.js';
import { isGrapeToken } from '../lib/grapes.js';
import { editDistance, identityTokens, normalize, tokensMatch } from '../lib/normalize.js';
import { isBroadPlaceToken } from '../lib/places.js';
import { findCandidates } from './matcher.js';
import { withJoins, type CandidateWine } from './score.js';

export interface TextMatch {
  outcome: 'auto' | 'unsure';
  /** 'exact': every identity word printed; 'fuzzy': garbled words corroborated by the appellation. */
  via?: 'exact' | 'fuzzy';
  wine: CandidateWine | null;
  vintage: string | null;
  /** Wines whose identity words were all on the label, most specific first. */
  fits: CandidateWine[];
}

/** A distinctive word: long enough that OCR noise won't produce it by chance. */
const MIN_DISTINCTIVE = 5;

function identityOf(c: CandidateWine): string[] {
  const prod = identityTokens(c.producer);
  const name = c.name ? identityTokens(c.name).filter((t) => !prod.includes(t) && !isBroadPlaceToken(t)) : [];
  return [...prod, ...name];
}

/** Every identity word is on the label, alone or as half of a run-together pair ("DITCHDIGGER"). */
function allOnLabel(identity: string[], hay: string[]): boolean {
  const seen = identity.map((t) => hay.some((h) => tokensMatch(t, h)));
  for (let i = 0; i + 1 < identity.length; i++) {
    const joined = identity[i]! + identity[i + 1]!;
    if (hay.some((h) => tokensMatch(joined, h))) seen[i] = seen[i + 1] = true;
  }
  return seen.every(Boolean);
}

const COLOUR_WORDS: Record<string, string> = { blanc: 'white', bianco: 'white', blanco: 'white', white: 'white', rose: 'rose', rosado: 'rose', rosato: 'rose' };

/** The vintage: a single plausible year, ignoring "depuis 1871" / "since 1885" / "est. 1902". */
export function vintageFromText(text: string, now = new Date()): string | null {
  const s = normalize(text);
  const years = new Set<string>();
  for (const m of s.matchAll(/(?:^|\s)((?:19|20)\d\d)(?=\s|$)/g)) {
    const y = Number(m[1]);
    const before = s.slice(Math.max(0, m.index! - 14), m.index! + 1);
    if (y < 1950 || y > now.getFullYear()) continue;
    if (/(depuis|since|founded|fonde|est|anno|seit|desde|dal)\s*$/.test(before.trim())) continue;
    years.add(m[1]!);
  }
  return years.size === 1 ? [...years][0]! : null;
}

export function matchTextCandidates(text: string, candidates: CandidateWine[]): Omit<TextMatch, 'vintage'> {
  const qTokens = identityTokens(text);
  const hay = withJoins(qTokens);
  const textColours = new Set(qTokens.map((t) => COLOUR_WORDS[t]).filter(Boolean));
  const labelGrapes = qTokens.filter(isGrapeToken);

  const fits: Array<{ c: CandidateWine; identity: string[] }> = [];
  for (const c of candidates) {
    const identity = identityOf(c);
    if (!identityTokens(c.producer).length) continue; // never trust a wine known by no producer
    if (!identity.some((t) => t.length >= MIN_DISTINCTIVE && !isGrapeToken(t) && !isBroadPlaceToken(t))) continue;
    if (!allOnLabel(identity, hay)) continue;
    // Colour: a rosé or white says so on the label; a colour word the wine doesn't have rules it out.
    const colour = c.colour || '';
    if (colour === 'rose' && !textColours.has('rose')) continue;
    if (textColours.size && colour && !textColours.has(colour)) continue;
    // A grape on the label that the wine can't account for: probably a sibling we don't know.
    const explains = withJoins(identityTokens(`${c.display_name} ${c.name} ${c.grape}`));
    if (labelGrapes.some((g) => !explains.some((e) => tokensMatch(g, e)))) continue;
    fits.push({ c, identity });
  }

  // Most specific fits: identity not strictly contained in another fit's.
  const contains = (a: string[], b: string[]) => b.every((t) => a.includes(t));
  let best = fits.filter((f) => !fits.some((g) => g !== f && g.identity.length > f.identity.length && contains(g.identity, f.identity)));
  // Same identity, different appellation (namesake chateaux, a main wine vs its white): the label must name it.
  if (best.length > 1) {
    const placed = best.filter((f) => {
      const place = identityTokens(f.c.sub_region || f.c.region).filter((t) => !isBroadPlaceToken(t));
      return place.length > 0 && allOnLabel(place, hay);
    });
    if (placed.length === 1) best = placed;
  }
  const ordered = [...fits].sort((a, b) => b.identity.length - a.identity.length).map((f) => f.c);
  return best.length === 1 ? { outcome: 'auto', wine: best[0]!.c, fits: ordered } : { outcome: 'unsure', wine: null, fits: ordered };
}

/** OCR misread: a long label word within 30% edits of the identity word. */
function nearly(word: string, target: string): boolean {
  if (word.length < 6 || target.length < 6) return false;
  const max = Math.floor(0.3 * Math.max(word.length, target.length));
  return editDistance(word, target, max) <= max;
}

const placeOf = (c: CandidateWine) => identityTokens(c.sub_region).filter((t) => !isBroadPlaceToken(t));

/** Second stage: fuzzy identity words, corroborated by the exact appellation on the label. */
export function fuzzyTextCandidates(text: string, candidates: CandidateWine[]): Omit<TextMatch, 'vintage'> {
  const qTokens = identityTokens(text);
  const hay = withJoins(qTokens);
  const ok: Array<{ c: CandidateWine; identity: string[] }> = [];
  for (const c of candidates) {
    const identity = identityOf(c);
    const place = placeOf(c);
    if (!identityTokens(c.producer).length || !place.length || !allOnLabel(place, hay)) continue;
    if (!identity.some((t) => t.length >= 6 && !isGrapeToken(t))) continue;
    if (!identity.every((t) => hay.some((h) => tokensMatch(t, h) || nearly(h, t)))) continue;
    // The usual colour and grape checks still apply: run the exact matcher with the misread words repaired.
    if (matchTextCandidates(`${text} ${identity.join(' ')}`, [c]).outcome !== 'auto') continue;
    ok.push({ c, identity });
  }
  const contains = (a: string[], b: string[]) => b.every((t) => a.includes(t));
  const best = ok.filter((f) => !ok.some((g) => g !== f && g.identity.length > f.identity.length && contains(g.identity, f.identity)));
  if (best.length === 1) return { outcome: 'auto', via: 'fuzzy', wine: best[0]!.c, fits: ok.map((f) => f.c) };
  return { outcome: 'unsure', wine: null, fits: ok.map((f) => f.c) };
}

export async function matchLabelText(db: Db, text: string): Promise<TextMatch> {
  const vintage = vintageFromText(text);
  const candidates = text.trim() ? await findCandidates(db, { text }) : [];
  const first = matchTextCandidates(text, candidates);
  if (first.outcome === 'auto' || first.fits.length) return { ...first, via: first.outcome === 'auto' ? 'exact' : undefined, vintage };
  // Nothing fits exactly: look up producers that long label words could be misreadings of.
  const words = [...new Set(identityTokens(text).filter((t) => t.length >= 6 && !isGrapeToken(t) && !isBroadPlaceToken(t)))].slice(0, 8);
  if (!words.length) return { ...first, vintage };
  const { rows } = await db.query(
    `WITH near AS (
       SELECT DISTINCT producer_norm FROM unnest($1::text[]) AS q(word)
         CROSS JOIN LATERAL (SELECT producer_norm FROM wines WHERE producer_norm % q.word
                              ORDER BY similarity(producer_norm, q.word) DESC LIMIT 10) p)
     SELECT w.wine_id, w.producer, w.name, w.display_name, w.region, w.sub_region, w.country,
            w.colour, w.grape, w.classification, w.source
       FROM wines w JOIN near USING (producer_norm) LIMIT 200`,
    [words]
  );
  return { ...fuzzyTextCandidates(text, rows as CandidateWine[]), vintage };
}
