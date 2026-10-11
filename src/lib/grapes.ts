/**
 * Common grape varieties (normalized). Used to (a) pull a grape out of a
 * retailer title when building a catalog entry from a crawl, and (b) tell
 * the matcher that "Cabernet Sauvignon" in a wine name is not a brand.
 * Longest names first so "sauvignon blanc" wins over "sauvignon".
 */
export const GRAPES: string[] = [
  'cabernet sauvignon', 'cabernet franc', 'sauvignon blanc', 'pinot noir', 'pinot grigio', 'pinot gris',
  'pinot blanc', 'pinot meunier', 'chenin blanc', 'petite sirah', 'petit verdot', 'grenache blanc',
  'gruner veltliner', 'nero davola', 'touriga nacional', 'tinta roriz', 'montepulciano', 'sangiovese grosso',
  'muscat blanc', 'moscato dasti', 'gewurztraminer', 'blaufrankisch', 'carmenere', 'tempranillo', 'nebbiolo',
  'sangiovese', 'zinfandel', 'primitivo', 'grenache', 'garnacha', 'mourvedre', 'monastrell', 'carignan',
  'cinsault', 'syrah', 'shiraz', 'merlot', 'malbec', 'barbera', 'dolcetto', 'aglianico', 'corvina', 'gamay',
  'pinotage', 'tannat', 'mencia', 'lagrein', 'sagrantino', 'chardonnay', 'riesling', 'viognier', 'albarino',
  'alvarinho', 'verdejo', 'vermentino', 'semillon', 'marsanne', 'roussanne', 'torrontes', 'furmint',
  'assyrtiko', 'garganega', 'trebbiano', 'fiano', 'falanghina', 'greco', 'cortese', 'arneis', 'muscadet',
  'melon', 'moscato', 'muscat', 'prosecco', 'glera', 'godello', 'xarello', 'macabeo', 'viura', 'palomino',
  'cabernet', 'sauvignon', 'pinot',
];

const GRAPE_TOKENS = new Set(GRAPES.flatMap((g) => g.split(' ')));

export function isGrapeToken(t: string): boolean {
  return GRAPE_TOKENS.has(t);
}

/** First grape named in already-normalized text, or ''. */
export function findGrape(normText: string): string {
  const s = ` ${normText} `;
  for (const g of GRAPES) if (s.includes(` ${g} `)) return g;
  return '';
}
