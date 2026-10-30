/**
 * The 90-second taste quiz (app: Welcome): well-known kinds of wine most
 * drinkers can place - "Marlborough Sauvignon Blanc", "Napa Cabernet" - each
 * a love it / it's fine / not for me / never had it. They describe styles,
 * not bottles, so they work whatever is in the catalog. Until the person has
 * rated real wines, each answer counts as a rating of a typical wine of that
 * kind (src/recs/recommend.ts, loadRatedTastings), so their first
 * suggestions, match scores and Jev's predictions start from what they said.
 */
import type { Db } from '../db/pool.js';
import { wineFeatures, recStyle, type RecStyle, type WineRow } from './features.js';

export interface Archetype {
  key: string;
  title: string;
  /** What it's like, in a few words. */
  detail: string;
  style: RecStyle;
  /** As a catalog row, for its features. */
  row: Omit<WineRow, 'wine_id'>;
  /** Typical tasting notes: its flavor families. */
  notes: string;
}

const a = (key: string, title: string, detail: string, row: Partial<WineRow>, notes: string): Omit<Archetype, 'style'> => ({
  key, title, detail, notes,
  row: { display_name: title, producer: '', grape: '', colour: '', wine_type: 'still', region: '', sub_region: '', country: '', ...row },
});

/** Shown in this order (filtered to the styles the person drinks), red, white and the rest interleaved. */
export const ARCHETYPES: Archetype[] = [
  a('napa-cab', 'Napa Valley Cabernet', 'Big, ripe, blackcurrant and oak', { grape: 'Cabernet Sauvignon', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'red' },
    'blackcurrant cassis black cherry oak vanilla cedar full bodied rich firm tannins'),
  a('nz-sauv', 'Marlborough Sauvignon Blanc', 'Zesty, grapefruit, passion fruit, grassy', { grape: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white' },
    'grapefruit lime passion fruit gooseberry grassy crisp zesty high acidity light'),
  a('burgundy-pinot', 'Red Burgundy (Pinot Noir)', 'Light, red cherry, earthy, silky', { grape: 'Pinot Noir', region: 'Burgundy', country: 'France', colour: 'red' },
    'red cherry raspberry earthy forest floor mushroom silky elegant light bodied fresh'),
  a('chablis', 'Chablis', 'Unoaked Chardonnay: lemon, chalk, crisp', { grape: 'Chardonnay', region: 'Burgundy', sub_region: 'Chablis', country: 'France', colour: 'white' },
    'lemon green apple chalk flint mineral crisp fresh light'),
  a('provence-rose', 'Provence rosé', 'Pale, dry, strawberry and citrus', { grape: 'Grenache', region: 'Provence', country: 'France', colour: 'rose' },
    'strawberry red currant citrus peach crisp dry fresh light'),
  a('champagne', 'Champagne', 'Toasty bubbles, apple, brioche', { region: 'Champagne', country: 'France', colour: 'white', wine_type: 'sparkling' },
    'green apple lemon brioche toast biscuit crisp fresh mineral'),
  a('malbec', 'Mendoza Malbec', 'Plush plum and blackberry, soft', { grape: 'Malbec', region: 'Mendoza', country: 'Argentina', colour: 'red' },
    'plum blackberry black cherry violet cocoa full bodied rich soft'),
  a('cali-chard', 'Buttery California Chardonnay', 'Oaky, vanilla, ripe apple, creamy', { grape: 'Chardonnay', region: 'California', country: 'USA', colour: 'white' },
    'ripe apple pear pineapple butter buttery vanilla oak toasty full bodied rich'),
  a('barolo', 'Barolo', 'Rose and tar, firm tannins, savory', { grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barolo', country: 'Italy', colour: 'red' },
    'cherry rose petal tar leather earthy firm tannins high acidity structured'),
  a('riesling', 'Mosel Riesling (off-dry)', 'Lime, peach, a touch sweet, racy', { grape: 'Riesling', region: 'Mosel', country: 'Germany', colour: 'white' },
    'lime peach apricot slate petrol off dry racy high acidity light'),
  a('rioja', 'Rioja Reserva', 'Cherry, vanilla, leather, smooth', { grape: 'Tempranillo', region: 'Rioja', country: 'Spain', colour: 'red' },
    'red cherry plum vanilla coconut oak leather tobacco medium bodied smooth'),
  a('prosecco', 'Prosecco', 'Light bubbles, pear and apple, easy', { grape: 'Glera', region: 'Veneto', country: 'Italy', colour: 'white', wine_type: 'sparkling' },
    'pear green apple melon floral light fresh off dry'),
  a('shiraz', 'Barossa Shiraz', 'Jammy blackberry, pepper, bold', { grape: 'Shiraz', region: 'South Australia', sub_region: 'Barossa Valley', country: 'Australia', colour: 'red' },
    'blackberry plum black pepper spice chocolate licorice full bodied bold'),
  a('albarino', 'Albariño', 'Saline, citrus, peach, fresh', { grape: 'Albarino', region: 'Galicia', sub_region: 'Rias Baixas', country: 'Spain', colour: 'white' },
    'lemon grapefruit peach saline mineral crisp fresh light'),
  a('port', 'Tawny Port', 'Sweet, nutty, caramel, dried fig', { region: 'Douro', country: 'Portugal', colour: 'red', wine_type: 'fortified' },
    'caramel toffee walnut hazelnut dried fig raisin sweet rich'),
  a('sauternes', 'Sauternes', 'Honeyed, apricot, marmalade, sweet', { grape: 'Semillon', region: 'Bordeaux', sub_region: 'Sauternes', country: 'France', colour: 'white', wine_type: 'dessert' },
    'honey apricot marmalade saffron sweet luscious rich'),
].map((x) => ({ ...x, style: recStyle(wineFeatures({ wine_id: 0, ...x.row }, { text: x.notes })) as RecStyle }));

export const ARCHETYPE_KEYS = ARCHETYPES.map((x) => x.key) as [string, ...string[]];
const BY_KEY = new Map(ARCHETYPES.map((x) => [x.key, x]));
export const archetype = (key: string) => BY_KEY.get(key);

export type Reaction = 'love' | 'fine' | 'dislike' | 'unknown';
/** What an answer counts as, as a rating; never-had-it says nothing. */
export const REACTION_RATING: Record<Reaction, number | null> = { love: 4.5, fine: 3.5, dislike: 2, unknown: null };

/** What a person usually spends on a bottle: the price band suggestions start from. */
export type Budget = 'under20' | '20to40' | '40to80' | 'over80';
export const BUDGET_CENTS: Record<Budget, number> = { under20: 1500, '20to40': 2800, '40to80': 5500, over80: 11000 };

export interface TastePrefs {
  styles: RecStyle[];
  budget: Budget | null;
  seeds: Partial<Record<string, Reaction>>;
  /** When the quiz was finished or skipped; null: not yet. */
  doneAt: string | null;
  skipped: boolean;
}

export async function loadPrefs(db: Db, userId: number): Promise<TastePrefs> {
  const [{ rows: [p] }, { rows: seeds }] = await Promise.all([
    db.query('SELECT styles, budget, done_at, skipped FROM taste_prefs WHERE user_id = $1', [userId]),
    db.query('SELECT archetype, reaction FROM taste_seeds WHERE user_id = $1', [userId]),
  ]);
  return {
    styles: (p?.styles ?? []) as RecStyle[],
    budget: (p?.budget ?? null) as Budget | null,
    seeds: Object.fromEntries(seeds.filter((s) => BY_KEY.has(s.archetype)).map((s) => [s.archetype, s.reaction as Reaction])),
    doneAt: p?.done_at ? new Date(p.done_at).toISOString() : null,
    skipped: Boolean(p?.skipped),
  };
}

export async function savePrefs(
  db: Db, userId: number, p: { styles?: RecStyle[]; budget?: Budget | null; seeds?: Partial<Record<string, Reaction>>; done?: boolean; skipped?: boolean }
): Promise<void> {
  await db.query(
    `INSERT INTO taste_prefs (user_id, styles, budget, done_at, skipped) VALUES ($1, COALESCE($2::text[], '{}'), $3, CASE WHEN $4::boolean THEN NOW() END, COALESCE($5::boolean, FALSE))
     ON CONFLICT (user_id) DO UPDATE SET
       styles = COALESCE($2::text[], taste_prefs.styles),
       budget = CASE WHEN $6::boolean THEN $3 ELSE taste_prefs.budget END,
       done_at = CASE WHEN $4::boolean THEN NOW() ELSE taste_prefs.done_at END,
       skipped = COALESCE($5::boolean, taste_prefs.skipped)`,
    [userId, p.styles ?? null, p.budget ?? null, Boolean(p.done), p.skipped ?? null, p.budget !== undefined]
  );
  for (const [key, reaction] of Object.entries(p.seeds ?? {})) {
    if (!BY_KEY.has(key) || !reaction) continue;
    await db.query(
      `INSERT INTO taste_seeds (user_id, archetype, reaction) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, archetype) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
      [userId, key, reaction]
    );
  }
}
