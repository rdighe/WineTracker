/**
 * Text normalization shared by the catalog, the matcher and the crawlers.
 *
 * Everything that is compared goes through normalize() first, so "Château
 * Lynch-Bages", "CH. LYNCH BAGES" and "chateau lynch bages" become the same
 * string. The SQL side stores already-normalized text (wines.*_norm) so
 * trigram search and the TypeScript scorer agree.
 */

// Abbreviations seen on labels and retailer titles, expanded before tokenizing.
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bch\.?(?=\s)/g, 'chateau'],
  [/\bchat\.(?=\s)/g, 'chateau'],
  [/\bdom\.(?=\s)/g, 'domaine'],
  [/\bst\.?(?=\s)/g, 'saint'],
  [/\bste\.?(?=\s)/g, 'sainte'],
  [/\bmt\.?(?=\s)/g, 'mount'],
  [/\bcab\.?\s+sauv\.?(?=\s|$)/g, 'cabernet sauvignon'],
  [/\bsauv\.?\s+blanc\b/g, 'sauvignon blanc'],
  [/\bn\.\s?v\.?(?=\s|$)/g, 'nv'],
  [/\bnon[\s-]?vintage\b/g, 'nv'],
];

/** Lowercase, strip accents, expand abbreviations, keep letters/digits only. */
export function normalize(input: unknown): string {
  let s = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')        // d'Yquem -> dyquem, matching how it is usually typed
    .replace(/&/g, ' and ')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss');
  s = ` ${s} `;
  for (const [re, rep] of ABBREVIATIONS) s = s.replace(re, rep);
  return s.replace(/[^a-z0-9.]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Words that carry no identity: articles, generic "winery" words. They are
 * dropped from token comparisons (but kept in normalize() output, so trigram
 * search still sees the full name).
 */
export const STOPWORDS = new Set([
  'the', 'and', 'of', 'de', 'di', 'du', 'da', 'do', 'del', 'della', 'dei', 'des', 'la', 'le', 'les', 'lo',
  'el', 'los', 'las', 'y', 'e', 'et', 'en', 'von', 'van', 'der', 'den', 'a', 'al', 'au', 'aux', 'il',
  'wine', 'wines', 'winery', 'vineyard', 'vineyards', 'cellars', 'cellar', 'estate', 'estates', 'family',
  'chateau', 'domaine', 'bodega', 'bodegas', 'cantina', 'tenuta', 'weingut', 'maison', 'quinta',
  'azienda', 'agricola', 'societa', 'company', 'co', 'inc', 'ltd', 'llc', 'vigneti', 'vins', 'vin', 'vino',
  'figli', 'figlio', 'fils', 'freres', 'sons', 'brothers', 'famille', 'hijos', 'erben', 'sohne',
]);

/**
 * Words retailers add to titles that say nothing about which wine it is.
 * Kept separate from STOPWORDS because some (red, white, rose) are useful as
 * colour hints even though they are not identity tokens.
 */
export const DESCRIPTOR_WORDS = new Set([
  'red', 'white', 'rose', 'rosado', 'rosato', 'blend', 'dry', 'sweet', 'still', 'sparkling',
  'bottle', 'bottles', 'btl', 'ml', 'l', 'cl', 'liter', 'litre', 'magnum', 'half', 'pack', 'case',
  'gift', 'box', 'boxed', 'with', 'in', 'vintage', 'nv', 'aoc', 'aop', 'doc', 'docg', 'igt', 'ava',
  'do', 'doca', 'qba', 'pradikatswein', 'pdo', 'pgi', 'brut', 'extra', 'organic', 'biodynamic',
  'limited', 'edition', 'release', 'new', 'sale', 'only', 'each', 'x', 'by',
]);

const YEAR_RE = /^(1[89]\d\d|20\d\d)$/;
const SIZE_TOKEN_RE = /^\d+(\.\d+)?(ml|l|cl|oz)?$/;

/** Identity tokens: normalized words minus stopwords, descriptors, years and sizes. */
export function identityTokens(input: unknown): string[] {
  const out: string[] = [];
  for (const t of normalize(input).split(' ')) {
    if (!t || t.length < 2) continue;
    if (STOPWORDS.has(t) || DESCRIPTOR_WORDS.has(t)) continue;
    if (YEAR_RE.test(t) || SIZE_TOKEN_RE.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Levenshtein distance capped at max+1 (we only ever ask "is it <= 1 or 2"). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Token equality tolerant of one OCR/typo error on longer words. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // One typo, on words long enough that one letter can't change the name:
  // "montelena"/"montelana" yes, "justin"/"austin" no.
  const len = Math.min(a.length, b.length);
  if (len >= 8 || (len >= 6 && a[0] === b[0])) return editDistance(a, b, 1) <= 1;
  return false;
}
