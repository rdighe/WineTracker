import { describe, expect, it } from 'vitest';
import { parseTitle, per750 } from '../src/lib/listing.js';

const now = new Date('2026-10-11');
const p = (t: string) => parseTitle(t, now);

describe('parseTitle', () => {
  it('reads vintage and size', () => {
    expect(p('Chateau Lynch-Bages 2015 750ml')).toMatchObject({ vintageKey: '2015', bottleMl: 750, packSize: 1, isWine: true });
    expect(p('Opus One 2019 1.5L')).toMatchObject({ vintageKey: '2019', bottleMl: 1500 });
    expect(p('Ridge Monte Bello 2018 Magnum')).toMatchObject({ vintageKey: '2018', bottleMl: 1500 });
    expect(p('Sauternes Chateau Suduiraut 2017 (375ML half-bottle)')).toMatchObject({ vintageKey: '2017', bottleMl: 375 });
    expect(p('Krug Grande Cuvée 171ème Édition 75cl')).toMatchObject({ bottleMl: 750 });
  });
  it('recognizes NV and leaves ambiguous years unknown', () => {
    expect(p('Veuve Clicquot Yellow Label Brut NV').vintageKey).toBe('NV');
    expect(p('Billecart-Salmon Brut Rosé Non-Vintage').vintageKey).toBe('NV');
    expect(p('Penfolds Grange 2016 & 2017 Vertical').vintageKey).toBeNull();
    expect(p('Beringer Founders Estate Cabernet').vintageKey).toBeNull();
  });
  it('ignores founding years and future years', () => {
    expect(p('Château Pontet-Canet, since 1705, 2016').vintageKey).toBe('2016');
    expect(p('Some Wine 2031').vintageKey).toBeNull();
  });
  it('reads pack sizes', () => {
    expect(p('Kim Crawford Sauvignon Blanc 2023 6 pack').packSize).toBe(6);
    expect(p('Caymus Cabernet 2021 case of 12').packSize).toBe(12);
    expect(p('La Crema Pinot Noir 2022 12 x 750ml')).toMatchObject({ packSize: 12, bottleMl: 750 });
  });
  it('flags non-wine products', () => {
    expect(p('Riedel Veritas Cabernet Glasses, set of 2').isWine).toBe(false);
    expect(p("Maker's Mark Bourbon 750ml").isWine).toBe(false);
    expect(p('Holiday Mixed Case Sampler').isWine).toBe(false);
    expect(p('Wine.com Gift Card').isWine).toBe(false);
  });
  it('keeps the identity text in rest', () => {
    expect(p('Chateau Lynch-Bages 2015 750ml').rest).toBe('Chateau Lynch-Bages');
  });
});

describe('per750', () => {
  it('normalizes pack and bottle size', () => {
    expect(per750(12000, 1500, 1)).toBe(6000);
    expect(per750(30000, 750, 6)).toBe(5000);
    expect(per750(2500, 375, 1)).toBe(5000);
    expect(per750(2500, null, 1)).toBe(2500);
  });
});

describe('marketing notes', () => {
  it('are stripped from the identity text', () => {
    expect(p('Conterno Giacomo 1989 Barolo (Arrives 11/26)').rest).toBe('Conterno Giacomo Barolo');
    expect(p('2025 Chateau Figeac - St. Emilion MAGNUM [Bordeaux Future ETA 2028] (1.5L)')).toMatchObject({ rest: 'Chateau Figeac - St. Emilion', bottleMl: 1500 });
    expect(p('2025 Martin Ray Sonoma Coast Chardonnay - Double Gold Medal Winner!').rest).toBe('Martin Ray Sonoma Coast Chardonnay');
    expect(p('Caymus Cabernet 2021 95 pts').rest).toBe('Caymus Cabernet');
  });
});
