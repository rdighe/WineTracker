/**
 * Flavour profile of a wine: a few broad flavour and structure families
 * ("black fruit", "earthy", "high acid"...) read from tasting notes - the
 * researched notes for the wine (wine_info), and the user's own tags and
 * notes - or, when a wine has no notes yet, the typical profile of its
 * grape and style. Recommendations compare these with the flavours of wines
 * the user rated, so a liked Northern Rhone Syrah can point to a peppery
 * Washington Syrah, not only to more wines from the Rhone.
 */
import { normalize } from '../lib/normalize.js';

export const FLAVOURS = {
  black_fruit: { label: 'black fruit', words: ['blackberry', 'blackberries', 'blackcurrant', 'black currant', 'cassis', 'black cherry', 'plum', 'blueberry', 'black fruit', 'dark fruit', 'mulberry', 'boysenberry'] },
  red_fruit: { label: 'red fruit', words: ['cherry', 'cherries', 'raspberry', 'strawberry', 'red currant', 'redcurrant', 'cranberry', 'red fruit', 'pomegranate', 'red berry', 'red berries'] },
  citrus: { label: 'citrus', words: ['lemon', 'lime', 'grapefruit', 'citrus', 'orange peel', 'zest', 'tangerine', 'yuzu'] },
  orchard: { label: 'apple & pear', words: ['apple', 'pear', 'quince', 'orchard'] },
  stone_fruit: { label: 'stone fruit', words: ['peach', 'apricot', 'nectarine', 'stone fruit'] },
  tropical: { label: 'tropical fruit', words: ['pineapple', 'mango', 'passion fruit', 'passionfruit', 'lychee', 'guava', 'tropical', 'melon', 'banana', 'papaya'] },
  floral: { label: 'floral', words: ['violet', 'rose petal', 'floral', 'blossom', 'jasmine', 'honeysuckle', 'lavender', 'elderflower', 'perfumed', 'flowers'] },
  herbal: { label: 'herbal', words: ['herb', 'herbal', 'mint', 'eucalyptus', 'green pepper', 'bell pepper', 'sage', 'thyme', 'grass', 'grassy', 'tomato leaf', 'garrigue', 'fennel', 'gooseberry'] },
  earthy: { label: 'earthy', words: ['earth', 'earthy', 'forest floor', 'mushroom', 'truffle', 'leather', 'tobacco', 'gamey', 'game', 'barnyard', 'underbrush', 'tar'] },
  mineral: { label: 'mineral', words: ['mineral', 'minerality', 'flint', 'flinty', 'chalk', 'chalky', 'slate', 'wet stone', 'saline', 'salty', 'graphite', 'petrol', 'iodine', 'crushed rock'] },
  oak: { label: 'oaky', words: ['oak', 'oaky', 'vanilla', 'toasty', 'cedar', 'smoke', 'smoky', 'coconut', 'butter', 'buttery', 'mocha', 'coffee', 'cocoa', 'chocolate'] },
  spice: { label: 'spicy', words: ['pepper', 'peppery', 'black pepper', 'spice', 'spicy', 'clove', 'cinnamon', 'licorice', 'liquorice', 'anise', 'nutmeg', 'baking spice', 'ginger'] },
  savory: { label: 'savory', words: ['olive', 'meaty', 'bacon', 'soy', 'umami', 'savory', 'savoury', 'smoked meat', 'cured meat'] },
  rich_sweet: { label: 'honeyed', words: ['honey', 'honeyed', 'marmalade', 'candied', 'dried fruit', 'fig', 'raisin', 'caramel', 'toffee', 'nutty', 'almond', 'hazelnut', 'walnut', 'saffron'] },
  yeasty: { label: 'brioche', words: ['brioche', 'bread', 'biscuit', 'yeast', 'yeasty', 'pastry', 'toast'] },
  tannic: { label: 'firm tannins', words: ['tannin', 'tannins', 'tannic', 'grippy', 'structured', 'firm', 'astringent'] },
  fresh: { label: 'high acidity', words: ['acidity', 'acidic', 'crisp', 'fresh', 'zesty', 'bright', 'vibrant', 'racy', 'tart', 'zippy', 'mouthwatering'] },
  full: { label: 'full-bodied', words: ['full bodied', 'full-bodied', 'rich', 'opulent', 'powerful', 'concentrated', 'bold', 'dense', 'robust', 'big'] },
  light: { label: 'light & elegant', words: ['light bodied', 'light-bodied', 'light', 'delicate', 'elegant', 'silky', 'finesse', 'ethereal'] },
  sweet: { label: 'sweet', words: ['sweet', 'off dry', 'off-dry', 'luscious', 'unctuous', 'dessert'] },
} as const;

export type Flavour = keyof typeof FLAVOURS;
/** Flavour -> weight (about 1 for each family a note mentions). */
export type FlavourProfile = Partial<Record<Flavour, number>>;

const ENTRIES = Object.entries(FLAVOURS) as [Flavour, (typeof FLAVOURS)[Flavour]][];

export const flavourLabel = (f: string) => (FLAVOURS as Record<string, { label: string }>)[f]?.label ?? f;

/** Flavour families mentioned in free text (notes, tags, researched descriptors). */
export function textFlavours(...texts: (string | null | undefined)[]): FlavourProfile {
  const s = ` ${normalize(texts.filter(Boolean).join(' ').replace(/-/g, ' '))} `;
  const out: FlavourProfile = {};
  for (const [key, { words }] of ENTRIES) {
    if (words.some((w) => s.includes(` ${normalize(w.replace(/-/g, ' '))} `))) out[key] = 1;
  }
  // "Light" also appears in "light tannins"/"light oak"; only trust it with no sign of a big wine.
  if (out.light && out.full) delete out.light;
  return out;
}

/** Typical profiles, for wines with no notes yet. Keys are grape names as src/lib/grapes.ts normalizes them. */
const GRAPE_FLAVOURS: Record<string, Flavour[]> = {
  'cabernet sauvignon': ['black_fruit', 'herbal', 'oak', 'tannic', 'full'],
  cabernet: ['black_fruit', 'herbal', 'oak', 'tannic', 'full'],
  'cabernet franc': ['red_fruit', 'herbal', 'earthy', 'fresh'],
  merlot: ['black_fruit', 'red_fruit', 'oak', 'full'],
  'pinot noir': ['red_fruit', 'earthy', 'floral', 'fresh', 'light'],
  pinot: ['red_fruit', 'earthy', 'fresh', 'light'],
  syrah: ['black_fruit', 'spice', 'savory', 'full'],
  shiraz: ['black_fruit', 'spice', 'oak', 'full'],
  grenache: ['red_fruit', 'spice', 'herbal', 'full'],
  garnacha: ['red_fruit', 'spice', 'herbal', 'full'],
  mourvedre: ['black_fruit', 'earthy', 'savory', 'tannic'],
  monastrell: ['black_fruit', 'earthy', 'savory', 'tannic'],
  malbec: ['black_fruit', 'floral', 'oak', 'full'],
  zinfandel: ['black_fruit', 'spice', 'full'],
  primitivo: ['black_fruit', 'spice', 'full'],
  'petite sirah': ['black_fruit', 'spice', 'tannic', 'full'],
  nebbiolo: ['red_fruit', 'floral', 'earthy', 'tannic', 'fresh'],
  sangiovese: ['red_fruit', 'herbal', 'earthy', 'fresh', 'tannic'],
  'sangiovese grosso': ['red_fruit', 'herbal', 'earthy', 'fresh', 'tannic'],
  tempranillo: ['red_fruit', 'oak', 'earthy', 'tannic'],
  'tinta roriz': ['red_fruit', 'oak', 'earthy', 'tannic'],
  barbera: ['red_fruit', 'fresh'],
  dolcetto: ['black_fruit', 'light'],
  aglianico: ['black_fruit', 'earthy', 'tannic', 'fresh'],
  gamay: ['red_fruit', 'floral', 'fresh', 'light'],
  corvina: ['red_fruit', 'rich_sweet', 'full'],
  carmenere: ['black_fruit', 'herbal', 'spice'],
  pinotage: ['black_fruit', 'earthy', 'spice'],
  tannat: ['black_fruit', 'tannic', 'full'],
  mencia: ['red_fruit', 'floral', 'mineral', 'fresh'],
  'touriga nacional': ['black_fruit', 'floral', 'full'],
  'nero davola': ['black_fruit', 'spice', 'full'],
  montepulciano: ['black_fruit', 'herbal', 'full'],
  blaufrankisch: ['black_fruit', 'spice', 'fresh'],
  cinsault: ['red_fruit', 'light', 'floral'],
  carignan: ['red_fruit', 'earthy', 'spice'],
  chardonnay: ['orchard', 'citrus', 'oak'],
  'sauvignon blanc': ['citrus', 'herbal', 'tropical', 'fresh'],
  sauvignon: ['citrus', 'herbal', 'fresh'],
  riesling: ['citrus', 'stone_fruit', 'mineral', 'fresh'],
  'chenin blanc': ['orchard', 'rich_sweet', 'fresh'],
  viognier: ['stone_fruit', 'floral', 'full'],
  'pinot grigio': ['orchard', 'citrus', 'light'],
  'pinot gris': ['orchard', 'stone_fruit', 'spice'],
  'pinot blanc': ['orchard', 'light'],
  albarino: ['citrus', 'stone_fruit', 'mineral', 'fresh'],
  alvarinho: ['citrus', 'stone_fruit', 'mineral', 'fresh'],
  gewurztraminer: ['floral', 'tropical', 'spice'],
  'gruner veltliner': ['citrus', 'herbal', 'spice', 'fresh'],
  semillon: ['citrus', 'rich_sweet'],
  vermentino: ['citrus', 'herbal', 'mineral'],
  marsanne: ['stone_fruit', 'rich_sweet', 'full'],
  roussanne: ['stone_fruit', 'floral', 'full'],
  torrontes: ['floral', 'citrus'],
  furmint: ['citrus', 'mineral', 'fresh'],
  assyrtiko: ['citrus', 'mineral', 'fresh'],
  garganega: ['orchard', 'citrus', 'rich_sweet'],
  fiano: ['stone_fruit', 'rich_sweet'],
  muscadet: ['citrus', 'mineral', 'fresh', 'light'],
  melon: ['citrus', 'mineral', 'fresh', 'light'],
  verdejo: ['citrus', 'herbal', 'fresh'],
  godello: ['orchard', 'mineral'],
  moscato: ['stone_fruit', 'floral', 'sweet'],
  muscat: ['stone_fruit', 'floral'],
  'moscato dasti': ['stone_fruit', 'floral', 'sweet'],
};

const STYLE_FLAVOURS: Record<string, Flavour[]> = {
  sparkling: ['yeasty', 'citrus', 'fresh'],
  dessert: ['rich_sweet', 'sweet'],
  fortified: ['rich_sweet', 'full'],
};

/**
 * A wine's flavours: from its tasting notes when it has any, else typical of
 * its grape (or style). Typical profiles count half: they are a guess.
 */
export function wineFlavours(grape: string | undefined, style: string | undefined, notes?: { descriptors?: string[]; text?: string } | null): FlavourProfile {
  if (notes && ((notes.descriptors?.length ?? 0) > 0 || notes.text)) {
    const read = textFlavours(...(notes.descriptors ?? []), notes.text);
    if (Object.keys(read).length) return read;
  }
  const typical = [...(grape ? GRAPE_FLAVOURS[grape] ?? [] : []), ...(style && style !== 'still' ? STYLE_FLAVOURS[style] ?? [] : [])];
  return Object.fromEntries([...new Set(typical)].map((f) => [f, 0.5])) as FlavourProfile;
}

/** Combine profiles, keeping the stronger weight per flavour. */
export function mergeFlavours(...profiles: FlavourProfile[]): FlavourProfile {
  const out: FlavourProfile = {};
  for (const p of profiles) for (const [k, w] of Object.entries(p) as [Flavour, number][]) out[k] = Math.max(out[k] ?? 0, w);
  return out;
}
