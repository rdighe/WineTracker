/**
 * Wine features used for taste profiles: the things a drinker's preferences
 * attach to. Inferred from the title when the catalog row lacks them (shop-
 * created wines often have no grape/colour fields).
 */
import { colourFromGrape, findGrape } from '../lib/grapes.js';
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

export type Features = Partial<Record<FeatureKind, string>>;

const COUNTRY_ALIASES: Record<string, string> = { 'united states': 'usa', us: 'usa', 'united states of america': 'usa', italia: 'italy', espana: 'spain' };

export function wineFeatures(w: WineRow): Features {
  const text = normalize(`${w.display_name} ${w.grape}`);
  const grape = normalize(w.grape) || findGrape(text);
  const s = ` ${text} `;
  const style = w.wine_type && w.wine_type !== 'still' ? w.wine_type
    : / (brut|champagne|sparkling|cremant|prosecco|cava|spumante|sekt) /.test(s) ? 'sparkling'
    : / (port|sherry|madeira|marsala) /.test(s) ? 'fortified'
    : / (sauternes|tokaji|late harvest|ice wine|eiswein|beerenauslese) /.test(s) ? 'dessert' : 'still';
  const colour = w.colour || (/ (rose|rosado|rosato) /.test(s) ? 'rose' : / (blanc|bianco|white) /.test(s) ? 'white' : colourFromGrape(text));
  const country = normalize(w.country);
  const f: Features = {
    grape: grape || undefined,
    appellation: normalize(w.sub_region) || undefined,
    region: normalize(w.region) || undefined,
    country: COUNTRY_ALIASES[country] ?? (country || undefined),
    producer: normalize(w.producer) || undefined,
    colour: colour || undefined,
    style,
  };
  return f;
}
