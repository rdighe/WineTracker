import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractOffer } from '../src/prices/extract.js';

const page = (f: string) => readFileSync(new URL(`./fixtures/pages/${f}`, import.meta.url), 'utf8');

describe('extractOffer', () => {
  it('reads JSON-LD products inside @graph, with brand and attributes', () => {
    expect(extractOffer(page('jsonld.html'))).toEqual({
      title: 'Château Lynch-Bages 2015 750ml',
      brand: 'Château Lynch-Bages',
      sku: 'LB15',
      gtin: '3760000000001',
      priceCents: 18999,
      currency: 'USD',
      inStock: true,
      attributes: { region: 'Pauillac, Bordeaux', varietal: 'Cabernet Sauvignon' },
      via: 'jsonld',
    });
  });
  it('uses AggregateOffer lowPrice and thousands separators', () => {
    expect(extractOffer(page('aggregate-offer.html'))).toMatchObject({ title: 'Opus One 2019', priceCents: 129900, inStock: null });
  });
  it('falls back to microdata', () => {
    expect(extractOffer(page('microdata.html'))).toMatchObject({ title: 'Ridge Monte Bello 2018', priceCents: 26500, currency: 'USD', inStock: false, via: 'microdata' });
  });
  it('falls back to Open Graph product meta', () => {
    expect(extractOffer(page('og.html'))).toMatchObject({ title: 'Kim Crawford Sauvignon Blanc 2023', priceCents: 1499, via: 'meta' });
  });
  it('returns null without structured data', () => {
    expect(extractOffer('<html><h1>Wine</h1><span class="price">$20</span></html>')).toBeNull();
  });
});
