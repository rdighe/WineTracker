import { describe, expect, it } from 'vitest';
import { offersFromProduct, tagAttributes } from '../src/prices/shopify.js';
import { offerFromWoo } from '../src/prices/woocommerce.js';
import { nonWineCategory } from '../src/prices/ingest.js';

describe('shopify feed', () => {
  it('maps variants to offers with per-variant URLs and tag attributes', () => {
    const offers = offersFromProduct(
      {
        id: 1, title: '2019 Roagna Barbaresco Paje', handle: 'roagna-paje-19', vendor: 'Roagna', product_type: 'Red Wine',
        tags: ['Country_Italy', 'Region: Piedmont', 'varietal_Nebbiolo', 'staff pick'],
        variants: [
          { id: 11, title: '750ml', price: '189.00', available: true, sku: 'R1' },
          { id: 12, title: '1.5 L', price: '420.00', available: false },
          { id: 13, title: 'Empty', price: '0.00' },
        ],
      },
      'https://shop.test'
    );
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      url: 'https://shop.test/products/roagna-paje-19?variant=11',
      offer: { title: '2019 Roagna Barbaresco Paje 750ml', brand: 'Roagna', priceCents: 18900, inStock: true, currency: 'USD' },
    });
    expect(offers[0]!.offer.attributes).toEqual({ country: 'Italy', region: 'Piedmont', varietal: 'Nebbiolo', category: 'Red Wine' });
    expect(tagAttributes('Color: Red, misc')).toEqual({ type: 'Red' });
  });
});

describe('woocommerce feed', () => {
  it('converts minor-unit prices and decodes entities', () => {
    expect(
      offerFromWoo({
        name: 'Carruades de Lafite Pauillac 2000 750ml &#8211; OWC', permalink: 'https://w.test/p/1', sku: '9',
        prices: { price: '33426', currency_code: 'USD', currency_minor_unit: 2 }, is_in_stock: true,
        categories: [{ name: 'Left Bank Bordeaux' }],
      })
    ).toMatchObject({ url: 'https://w.test/p/1', offer: { title: 'Carruades de Lafite Pauillac 2000 750ml – OWC', priceCents: 33426, attributes: { category: 'Left Bank Bordeaux' } } });
    expect(offerFromWoo({ name: 'x', permalink: 'https://w.test/p/2', prices: { price: '0' } })).toBeNull();
  });
});

describe('nonWineCategory', () => {
  it('flags spirits and accessories but not wine categories', () => {
    expect(nonWineCategory({ category: 'Scotch Whisky' })).toBe(true);
    expect(nonWineCategory({ category: 'Glassware & Accessories' })).toBe(true);
    expect(nonWineCategory({ category: 'Red Wine' })).toBe(false);
    expect(nonWineCategory({ category: 'Port & Fortified Wine' })).toBe(false);
    expect(nonWineCategory({})).toBe(false);
  });
});
