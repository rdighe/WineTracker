/**
 * Rule-based parsing of a retailer product title (or label text) into the
 * parts that matter for pricing: vintage, bottle size, pack size, and whether
 * the product is wine at all. The remaining text goes to the matcher.
 *
 * Deliberately conservative: when unsure, leave a field null rather than
 * guess. A wrong vintage or size silently corrupts the price data; a missing
 * one only excludes the listing from per-vintage aggregates.
 */

export interface ParsedTitle {
  vintageKey: string | null;  // '2015' | 'NV' | null (unknown)
  bottleMl: number | null;    // null = not stated (callers usually assume 750)
  packSize: number;           // bottles per offer
  isWine: boolean;
  rest: string;               // title with vintage/size/pack text removed
}

const NAMED_SIZES: Array<[RegExp, number]> = [
  [/\b(double[\s-]?magnum)\b/i, 3000],
  [/\bjeroboam\b/i, 3000],
  [/\brehoboam\b/i, 4500],
  [/\bmethuselah\b/i, 6000],
  [/\bimperial\b(?!\s+(stout|reserve|gold))/i, 6000],
  [/\bsalmanazar\b/i, 9000],
  [/\bmagnum\b/i, 1500],
  [/\b(half[\s-]?bottle|demi[\s-]?bouteille|demi)\b/i, 375],
  [/\b(piccolo|split)\b/i, 187],
];

const NOT_WINE = new RegExp(
  [
    'gift\\s*card', 'gift\\s*basket', 'glass(es|ware)?\\b', 'decanter', 'corkscrew', 'opener', 'aerator',
    'stopper', 'wine\\s*rack', 'tote', 'subscription', 'tasting\\s*kit', 'membership', 'chiller', 'cooler bag',
    'whisk(e)?y', 'bourbon', 'vodka', '\\bgin\\b', 'tequila', 'mezcal', '\\brum\\b', 'cognac', 'armagnac',
    'brandy', 'liqueur', '\\bbeer\\b', '\\bipa\\b', '\\blager\\b', '\\bale\\b', '\\bcider\\b', 'hard seltzer',
    '\\bsake\\b', 'soju', 'cocktail', 'mixer', 'bitters', 'non[\\s-]?alcoholic', 'dealcoholi[sz]ed',
    'gourmet', 'chocolate', 'cheese', 'candle', 'book\\b', 'scotch', 'single malt', '\\brye\\b', 'amaro', 'fernet',
    'grappa', 'pisco', '\\bbitter\\b', 'limoncello', 'sambuca', 'ouzo', 'arak', 'absinthe', 'shochu', 'baijiu', 'eau de vie', 'calvados', 'aperitivo', 'campari', 'aperol',
  ].join('|'),
  'i'
);

export function parseTitle(title: string, now = new Date()): ParsedTitle {
  let rest = ` ${title} `;
  const maxYear = now.getUTCFullYear() + 1;

  // ── Pack size ────────────────────────────────────────────────────────────
  let packSize = 1;
  const packPatterns: RegExp[] = [
    /\b(\d{1,2})\s*[-\s]?\s*(?:pk|pack)\b/i,                  // 6 pack, 6-pk
    /\bcase\s+of\s+(\d{1,2})\b/i,                             // case of 12
    /\bpack\s+of\s+(\d{1,2})\b/i,
    /\b(\d{1,2})\s*x\s*(?=\d+(?:\.\d+)?\s*(?:ml|l|cl)\b)/i,  // 12 x 750ml
    /\(\s*(\d{1,2})\s*(?:bottles|btls)\s*\)/i,                // (6 bottles)
    /\b(\d{1,2})\s+bottles?\s+(?:set|case|collection|bundle)\b/i,
  ];
  for (const re of packPatterns) {
    const m = rest.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 24) packSize = n;
      rest = rest.replace(m[0], ' ');
      break;
    }
  }
  if (packSize === 1 && /\b(mixed|assorted|variety)\s+(case|pack|set)\b|\bsampler\b/i.test(rest)) {
    // Mixed cases can't be priced per wine.
    return { vintageKey: null, bottleMl: null, packSize: 1, isWine: false, rest: rest.trim() };
  }

  // ── Bottle size ──────────────────────────────────────────────────────────
  let bottleMl: number | null = null;
  const sizeRe = /\b(\d+(?:\.\d+)?)\s*(ml|mls|cl|l|lt|ltr|liter|litre|liters|litres)\b\.?/i;
  const sm = rest.match(sizeRe);
  if (sm) {
    const v = Number(sm[1]);
    const unit = sm[2]!.toLowerCase();
    const ml = unit.startsWith('m') ? v : unit === 'cl' ? v * 10 : v * 1000;
    if (ml >= 50 && ml <= 30000) bottleMl = Math.round(ml);
    rest = rest.replace(sm[0], ' ');
  } else {
    for (const [re, ml] of NAMED_SIZES) {
      const m = rest.match(re);
      if (m) {
        bottleMl = ml;
        rest = rest.replace(m[0], ' ');
        break;
      }
    }
  }

  // Named size words left over when a numeric size was also given ("MAGNUM (1.5L)").
  for (const [re] of NAMED_SIZES) rest = rest.replace(re, ' ');

  // ── Vintage ──────────────────────────────────────────────────────────────
  let vintageKey: string | null = null;
  if (/\b(n\.?\s?v\.?|non[\s-]?vintage)(?=[\s,)]|$)/i.test(rest)) {
    vintageKey = 'NV';
    rest = rest.replace(/\b(n\.?\s?v\.?|non[\s-]?vintage)(?=[\s,)]|$)/i, ' ');
  } else {
    // Years that are part of a name ("since 1855", "est. 1902", "1855 classification")
    // are not vintages.
    const yearRe = /(?<![\d.])(1[89]\d\d|20\d\d)(?![\d.]|\s*(?:ml|l)\b)/g;
    const found: string[] = [];
    for (const m of rest.matchAll(yearRe)) {
      const y = Number(m[1]);
      const before = rest.slice(Math.max(0, m.index! - 12), m.index!).toLowerCase();
      const after = rest.slice(m.index! + 4, m.index! + 20).toLowerCase();
      if (y < 1900 || y > maxYear) continue;
      if (/(since|est\.?|established|founded)\s*$/.test(before)) continue;
      if (/^\s*(classification|cru class)/.test(after)) continue;
      found.push(m[1]!);
    }
    const distinct = [...new Set(found)];
    if (distinct.length === 1) {
      vintageKey = distinct[0]!;
      rest = rest.replace(new RegExp(`(?<![\\d.])${vintageKey}(?![\\d.])`, 'g'), ' ');
    }
    // Several different years (verticals, "2015 & 2016") -> unknown.
  }

  const isWine = !NOT_WINE.test(title);
  rest = stripMarketing(rest);
  rest = rest.replace(/\s*[|,–—-]\s*$/g, ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return { vintageKey, bottleMl, packSize, isWine, rest };
}

/** Price per 750 ml bottle in cents. */
export function per750(priceCents: number, bottleMl: number | null, packSize: number): number {
  const ml = bottleMl ?? 750;
  return Math.max(1, Math.round((priceCents / Math.max(1, packSize)) * (750 / ml)));
}

/**
 * Remove retailer notes that aren't part of the wine's name: bracketed notes
 * ("(Arrives 11/26)", "[Bordeaux Future ETA 2028]"), medal/score blurbs,
 * and shipping/condition notes.
 */
export function stripMarketing(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\s[-–—|:]\s.*\b(medal|winner|points?|pts|rated|award|award-winning|best buy|top \d+|sale|special|limited)\b.*$/i, ' ')
    .replace(/\b\d{2,3}\s*(pts|points)\b|\b(ws|wa|rp|js|jd|ag|wе|ve|we|wine spectator|wine advocate)\s*\d{2,3}\b/gi, ' ')
    .replace(/\b(pre[-\s]?arrival|futures?|en primeur|owc|oc|original wooden case|in stock|on sale|sale|new arrival|free shipping|ships? (?:now|in)\b.*)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
