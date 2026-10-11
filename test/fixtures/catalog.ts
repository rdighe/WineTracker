import type { NewWine } from '../../src/catalog/wines.js';

// Small catalog with deliberate traps: several wines per producer, second
// wines, colour variants and near-identical names.
export const CATALOG: Array<NewWine & { key: string }> = [
  { key: 'lynch-bages', producer: 'Chateau Lynch-Bages', name: '', region: 'Bordeaux', sub_region: 'Pauillac', country: 'France', colour: 'red', source: 'lwin', lwin: '1012361' },
  { key: 'lynch-bages-blanc', producer: 'Chateau Lynch-Bages', name: 'Blanc de Lynch-Bages', region: 'Bordeaux', country: 'France', colour: 'white', source: 'lwin', lwin: '1013000' },
  { key: 'echo-lynch-bages', producer: 'Chateau Lynch-Bages', name: "Echo de Lynch-Bages", region: 'Bordeaux', sub_region: 'Pauillac', country: 'France', colour: 'red', source: 'lwin', lwin: '1013001' },
  { key: 'margaux', producer: 'Chateau Margaux', name: '', region: 'Bordeaux', sub_region: 'Margaux', country: 'France', colour: 'red', source: 'lwin', lwin: '1012781' },
  { key: 'pavillon-rouge', producer: 'Chateau Margaux', name: 'Pavillon Rouge du Chateau Margaux', region: 'Bordeaux', sub_region: 'Margaux', country: 'France', colour: 'red', source: 'lwin', lwin: '1012782' },
  { key: 'pavillon-blanc', producer: 'Chateau Margaux', name: 'Pavillon Blanc du Chateau Margaux', region: 'Bordeaux', country: 'France', colour: 'white', source: 'lwin', lwin: '1012783' },
  { key: 'palmer', producer: 'Chateau Palmer', name: '', region: 'Bordeaux', sub_region: 'Margaux', country: 'France', colour: 'red', source: 'lwin' },
  { key: 'opus-one', producer: 'Opus One', name: '', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'red', source: 'lwin' },
  { key: 'overture', producer: 'Opus One', name: 'Overture', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'red', source: 'lwin' },
  { key: 'caymus-cab', producer: 'Caymus Vineyards', name: 'Cabernet Sauvignon', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'red', grape: 'Cabernet Sauvignon', source: 'lwin' },
  { key: 'caymus-ss', producer: 'Caymus Vineyards', name: 'Special Selection Cabernet Sauvignon', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'red', grape: 'Cabernet Sauvignon', source: 'lwin' },
  { key: 'montelena-chard', producer: 'Chateau Montelena', name: 'Chardonnay', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'white', grape: 'Chardonnay', source: 'lwin' },
  { key: 'montelena-cab', producer: 'Chateau Montelena', name: 'Estate Cabernet Sauvignon', region: 'California', sub_region: 'Napa Valley', country: 'USA', colour: 'red', grape: 'Cabernet Sauvignon', source: 'lwin' },
  { key: 'ridge-mb', producer: 'Ridge Vineyards', name: 'Monte Bello', region: 'California', sub_region: 'Santa Cruz Mountains', country: 'USA', colour: 'red', source: 'lwin' },
  { key: 'ridge-geyserville', producer: 'Ridge Vineyards', name: 'Geyserville', region: 'California', sub_region: 'Sonoma County', country: 'USA', colour: 'red', source: 'lwin' },
  { key: 'veuve-yellow', producer: 'Veuve Clicquot', name: 'Yellow Label Brut', region: 'Champagne', country: 'France', colour: 'white', wine_type: 'sparkling', source: 'lwin' },
  { key: 'veuve-rose', producer: 'Veuve Clicquot', name: 'Brut Rose', region: 'Champagne', country: 'France', colour: 'rose', wine_type: 'sparkling', source: 'lwin' },
  { key: 'veuve-gd', producer: 'Veuve Clicquot', name: 'La Grande Dame', region: 'Champagne', country: 'France', colour: 'white', wine_type: 'sparkling', source: 'lwin' },
  { key: 'drc-tache', producer: 'Domaine de la Romanee-Conti', name: 'La Tache Grand Cru', region: 'Burgundy', country: 'France', colour: 'red', source: 'lwin' },
  { key: 'drc-rc', producer: 'Domaine de la Romanee-Conti', name: 'Romanee-Conti Grand Cru', region: 'Burgundy', country: 'France', colour: 'red', source: 'lwin' },
  { key: 'yquem', producer: "Chateau d'Yquem", name: '', region: 'Bordeaux', sub_region: 'Sauternes', country: 'France', colour: 'white', wine_type: 'dessert', source: 'lwin' },
  { key: 'kim-sb', producer: 'Kim Crawford', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', grape: 'Sauvignon Blanc', source: 'crawl' },
  { key: 'cloudy-sb', producer: 'Cloudy Bay', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', grape: 'Sauvignon Blanc', source: 'lwin' },
  { key: 'tignanello', producer: 'Marchesi Antinori', name: 'Tignanello', region: 'Tuscany', country: 'Italy', colour: 'red', source: 'lwin' },
  { key: 'solaia', producer: 'Marchesi Antinori', name: 'Solaia', region: 'Tuscany', country: 'Italy', colour: 'red', source: 'lwin' },
  { key: 'sassicaia', producer: 'Tenuta San Guido', name: 'Sassicaia', region: 'Tuscany', sub_region: 'Bolgheri', country: 'Italy', colour: 'red', source: 'lwin' },
  { key: 'droin-chablis', producer: 'Jean-Paul & Benoit Droin', name: 'Chablis', region: 'Burgundy', country: 'France', colour: 'white', source: 'crawl' },
  { key: 'whispering-angel', producer: "Chateau d'Esclans", name: 'Whispering Angel Rose', region: 'Provence', country: 'France', colour: 'rose', source: 'lwin' },
];
