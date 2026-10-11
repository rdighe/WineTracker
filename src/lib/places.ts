/**
 * Broad wine places: countries, states, and large regions / AVAs that shops
 * add to titles as description ("... Sauvignon Blanc Wairarapa", "Ridge Monte
 * Bello Santa Cruz Mountains"). The matcher treats these words as neutral.
 *
 * Deliberately NOT listed: appellations and vineyards that identify a wine
 * (Chablis, Gevrey-Chambertin, Barolo, Brunate, Pauillac...). "Droin Chablis"
 * and "Droin Chablis Les Clos" must stay different wines.
 */
import { normalize } from './normalize.js';

const PLACES = [
  // countries
  'usa', 'united states', 'america', 'france', 'italy', 'italia', 'spain', 'espana', 'portugal', 'germany', 'deutschland',
  'austria', 'osterreich', 'greece', 'hungary', 'slovenia', 'croatia', 'georgia', 'lebanon', 'israel', 'south africa',
  'australia', 'new zealand', 'argentina', 'chile', 'uruguay', 'canada', 'england', 'switzerland', 'mexico',
  // US states and broad regions / large AVAs
  'california', 'oregon', 'washington', 'washington state', 'new york', 'virginia', 'idaho', 'texas', 'michigan',
  'napa', 'napa valley', 'sonoma', 'sonoma county', 'sonoma coast', 'north coast', 'central coast', 'south coast',
  'paso robles', 'santa barbara', 'santa barbara county', 'santa cruz', 'santa cruz mountains', 'mount', 'mountain', 'mountains',
  'russian river', 'russian river valley', 'alexander valley', 'dry creek valley', 'anderson valley', 'mendocino',
  'mendocino county', 'lodi', 'el dorado', 'el dorado county', 'amador', 'amador county', 'sierra foothills',
  'monterey', 'monterey county', 'livermore valley', 'carneros', 'los carneros', 'lake county', 'san luis obispo',
  'willamette valley', 'columbia valley', 'walla walla', 'yakima valley', 'finger lakes', 'long island', 'county', 'valley', 'coast',
  // New Zealand / Australia
  'marlborough', 'wairarapa', 'martinborough', 'hawkes bay', 'central otago', 'nelson', 'gisborne', 'canterbury',
  'barossa', 'barossa valley', 'mclaren vale', 'south australia', 'western australia', 'margaret river', 'yarra valley',
  'victoria', 'tasmania', 'clare valley', 'eden valley', 'adelaide hills', 'hunter valley', 'coonawarra',
  // South America / South Africa
  'mendoza', 'uco valley', 'patagonia', 'salta', 'maipo', 'maipo valley', 'colchagua', 'casablanca', 'maule',
  'western cape', 'stellenbosch', 'swartland',
  // large European regions used descriptively
  'toscana', 'tuscany', 'sicilia', 'sicily', 'veneto', 'puglia', 'campania', 'sardegna', 'sardinia', 'piemonte', 'piedmont',
  'provence', 'languedoc', 'roussillon', 'languedoc roussillon', 'pays doc', 'south of france', 'sud ouest',
];

const PLACE_TOKENS = new Set(PLACES.flatMap((p) => normalize(p).split(' ')));

export function isBroadPlaceToken(t: string): boolean {
  return PLACE_TOKENS.has(t);
}
