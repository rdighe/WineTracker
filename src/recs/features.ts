/**
 * Wine features used for taste profiles: the things a drinker's preferences
 * attach to. Inferred from the title when the catalog row lacks them (shop-
 * created wines often have no grape/colour fields).
 */
import { colourFromGrape, findGrape } from '../lib/grapes.js';
import { wineFlavours, type FlavourProfile } from './flavours.js';
import { normalize } from '../lib/normalize.js';

export type FeatureKind = 'grape' | 'appellation' | 'region' | 'country' | 'producer' | 'colour' | 'style';
export const FEATURE_KINDS: FeatureKind[] = ['grape', 'appellation', 'region', 'country', 'producer', 'colour', 'style'];

export interface WineRow {
  wine_id: number;
  display_name: string;
  producer: string;
  grape: string;
  colour: string;
  wine_type: string;
  region: string;
  sub_region: string;
  country: string;
}

export type Features = Partial<Record<FeatureKind, string>> & {
  /** Flavour families from tasting notes, else typical of the grape/style (src/recs/flavours.ts). */
  flavours?: FlavourProfile;
};

/** Researched notes for a wine, when it has some (wine_info). */
export interface WineNotes {
  descriptors?: string[];
  text?: string;
}

// Classic appellations name the place, not the grape. When a wine records
// no grape, its appellation tells us (for profiles only, not matching).
const APPELLATION_GRAPES: Array<[RegExp, string]> = [
  [/\b(barolo|barbaresco|gattinara|ghemme|roero|langhe nebbiolo|nebbiolo d ?alba|valtellina|sforzato)\b/, 'nebbiolo'],
  [/\b(brunello di montalcino|rosso di montalcino|chianti|vino nobile|morellino)\b/, 'sangiovese'],
  [/\b(chablis|meursault|puligny montrachet|chassagne montrachet|corton charlemagne|pouilly fuisse|saint aubin|macon)\b/, 'chardonnay'],
  [/\b(sancerre|pouilly fume|quincy|menetou salon)\b/, 'sauvignon blanc'],
  [/\b(vouvray|savennieres|montlouis)\b/, 'chenin blanc'],
  [/\b(cote rotie|hermitage|crozes hermitage|cornas|saint joseph)\b/, 'syrah'],
  [/\b(gevrey chambertin|vosne romanee|chambolle musigny|nuits saint georges|pommard|volnay|morey saint denis|clos de vougeot|echezeaux|richebourg|chambertin|bonnes mares|clos de la roche|santenay|marsannay)\b/, 'pinot noir'],
  [/\b(rioja|ribera del duero|toro)\b/, 'tempranillo'],
  [/\b(amarone|valpolicella)\b/, 'corvina'],
  [/\b(beaujolais|morgon|fleurie|moulin a vent|chiroubles|julienas|brouilly|chenas|regnie|saint amour)\b/, 'gamay'],
  [/\b(pauillac|margaux|saint julien|saint estephe|pessac leognan|haut medoc|medoc)\b/, 'cabernet sauvignon'],
  [/\b(pomerol|saint emilion|lalande de pomerol)\b/, 'merlot'],
  [/\b(chateauneuf du pape|gigondas|vacqueyras|cotes du rhone)\b/, 'grenache'],
];

function grapeFromAppellation(text: string, colour: string): string {
  if (colour === 'white' && !/chablis|meursault|montrachet|charlemagne|fuisse|aubin|macon|sancerre|pouilly fume|quincy|menetou|vouvray|savennieres|montlouis/.test(text)) return '';
  for (const [re, grape] of APPELLATION_GRAPES) if (re.test(text)) return grape;
  return '';
}

const COUNTRY_ALIASES: Record<string, string> = { 'united states': 'usa', us: 'usa', 'united states of america': 'usa', italia: 'italy', espana: 'spain' };

export function wineFeatures(w: WineRow, notes?: WineNotes | null): Features {
  const text = normalize(`${w.display_name} ${w.grape}`);
  const s = ` ${text} `;
  const place = normalize(`${w.sub_region} ${w.display_name}`);
  const style = w.wine_type && w.wine_type !== 'still' ? w.wine_type
    : / (brut|champagne|sparkling|cremant|prosecco|cava|spumante|sekt) /.test(s) ? 'sparkling'
    : / (port|sherry|madeira|marsala) /.test(s) ? 'fortified'
    : / (sauternes|tokaji|late harvest|ice wine|eiswein|beerenauslese) /.test(s) ? 'dessert' : 'still';
  const named = w.colour || (/ (rose|rosado|rosato) /.test(s) ? 'rose' : / (blanc|bianco|white) /.test(s) ? 'white' : colourFromGrape(text));
  const grape = normalize(w.grape) || findGrape(text) || grapeFromAppellation(place, named);
  // "Pessac", "Pommard": no grape in the name, but the appellation implies one, and so a colour.
  const colour = named || colourFromGrape(grape);
  const country = normalize(w.country);
  const f: Features = {
    grape: grape || undefined,
    appellation: normalize(w.sub_region) || undefined,
    region: normalize(w.region) || undefined,
    country: COUNTRY_ALIASES[country] ?? (country || undefined),
    producer: normalize(w.producer) || undefined,
    colour: colour || undefined,
    style,
    flavours: wineFlavours(grape || undefined, style, notes),
  };
  return f;
}

export type RecStyle = 'red' | 'white' | 'rose' | 'sparkling' | 'orange' | 'sweet';
export const REC_STYLES: RecStyle[] = ['red', 'white', 'rose', 'sparkling', 'orange', 'sweet'];

/** For you's style filter and the styles it takes turns between: sparkling, sweet (dessert and fortified), rosé, orange, red, white. '' = unknown. */
export function recStyle(f: Features): RecStyle | '' {
  if (f.style === 'sparkling') return 'sparkling';
  if (f.style === 'fortified' || f.style === 'dessert') return 'sweet';
  if (f.colour === 'rose' || f.colour === 'orange' || f.colour === 'red' || f.colour === 'white') return f.colour;
  return '';
}

/** Older app versions' colour filter: still reds, still whites, and everything else (rosé, sparkling, sweet, fortified). '' = unknown. */
export function wineCategory(f: Features): 'red' | 'white' | 'other' | '' {
  if (f.style && f.style !== 'still') return 'other';
  if (f.colour === 'rose') return 'other';
  return f.colour === 'red' || f.colour === 'white' ? f.colour : '';
}
