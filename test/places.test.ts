import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import type { LlmProvider, MerchantPlaces } from '../src/llm/types.js';
import { sanitizeMerchantPlaces } from '../src/llm/sanitize.js';
import { createPlaces, miles, parseNear } from '../src/places/places.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { forgetRecommendationCandidates } from '../src/recs/recommend.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  forgetRecommendationCandidates(db);
});
afterAll(closeDb);

// Palo Alto, CA: where the person is.
const PALO_ALTO = '37.44,-122.16,CA';

describe('where shops are', () => {
  it('reads a location, and keeps only well-formed stores and states from the model', () => {
    expect(parseNear(PALO_ALTO)).toEqual({ lat: 37.44, lng: -122.16, state: 'CA' });
    expect(parseNear(',,ny')).toEqual({ lat: null, lng: null, state: 'NY' });
    expect(parseNear('999,5,XX')).toBeNull();
    expect(parseNear(undefined)).toBeNull();
    expect(Math.round(miles(37.44, -122.16, 37.77, -122.42))).toBe(27);

    expect(sanitizeMerchantPlaces({
      stores: [{ name: 'SF', city: 'San Francisco', state: 'ca', lat: '37.77', lng: -122.42 }, { name: 'nowhere' }, { city: 'Austin', state: 'TX' }],
      ships_to: ['ca', 'NY', 'ZZ', 'ny'],
      sources: [{ url: 'https://shop.example/shipping' }],
    })).toEqual({
      stores: [
        { name: 'SF', address: '', city: 'San Francisco', state: 'CA', postal: '', lat: 37.77, lng: -122.42 },
        { name: '', address: '', city: 'Austin', state: 'TX', postal: '', lat: null, lng: null },
      ],
      shipsTo: ['CA', 'NY'],
      sources: [{ title: 'shop.example', url: 'https://shop.example/shipping' }],
    });
  });

  async function setup() {
    const found: Record<string, MerchantPlaces> = {
      'sf.test': { stores: [{ name: 'SF', address: '', city: 'San Francisco', state: 'CA', postal: '', lat: 37.77, lng: -122.42 }], shipsTo: [], sources: [] },
      'ny.test': { stores: [{ name: 'NYC', address: '', city: 'New York', state: 'NY', postal: '', lat: 40.71, lng: -74.0 }], shipsTo: ['CA', 'NY'], sources: [] },
      'tx.test': { stores: [{ name: 'Austin', address: '', city: 'Austin', state: 'TX', postal: '', lat: 30.27, lng: -97.74 }], shipsTo: ['TX'], sources: [] },
    };
    const researchMerchant = vi.fn(async (q: { domain: string }) => found[q.domain]!);
    const provider: LlmProvider = { name: 'fake', readLabel: vi.fn(), searchPrices: vi.fn(async () => []), researchMerchant };
    const places = createPlaces(db, provider, () => {});
    const app = createApp({ db, provider, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, places });
    const shop = async (domain: string) => (await db.query(`INSERT INTO merchants (domain, name) VALUES ($1, $2) RETURNING merchant_id`, [domain, domain.split('.')[0]!.toUpperCase()])).rows[0].merchant_id;
    const sf = await shop('sf.test');
    const ny = await shop('ny.test');
    const tx = await shop('tx.test');
    const sell = (wineId: number, merchantId: number, cents: number) =>
      db.query(`INSERT INTO price_observations (wine_id, vintage_key, price_cents, unit_750_cents, in_stock, source_type, merchant_id, url) VALUES ($1, NULL, $2, $2, true, 'crawl', $3, $4)`, [wineId, cents, merchantId, `https://${merchantId}.test/${wineId}`]);
    return { app, places, researchMerchant, sf, ny, tx, sell };
  }

  it("orders a wine's shops by how close they are, looking shops up the first time", async () => {
    const { app, places, researchMerchant, sf, ny, tx, sell } = await setup();
    const wine = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    await sell(wine, tx, 20000);
    await sell(wine, ny, 25000);
    await sell(wine, sf, 27000);
    const get = () => request(app).get(`/api/wines/${wine}/prices?near=${PALO_ALTO}`);

    // First time: the shops are being looked up; the offers come as they are.
    expect((await get()).body.near).toMatchObject({ applied: false, state: 'CA', pending: 3 });
    await places.drained();
    expect(researchMerchant).toHaveBeenCalledTimes(3);

    const r = (await get()).body;
    expect(r.near).toEqual({ applied: true, state: 'CA', pending: 0 });
    expect(r.offers.map((o: { merchant: string; nearby: unknown }) => [o.merchant, o.nearby])).toEqual([
      ['SF', { local: true, miles: expect.any(Number), city: 'San Francisco', ships: false }],
      ['NY', { local: false, miles: null, city: '', ships: true }],
      ['TX', null],
    ]);
    // Without a location: cheapest first, as before.
    expect((await request(app).get(`/api/wines/${wine}/prices`)).body.offers.map((o: { merchant: string }) => o.merchant)).toEqual(['TX', 'NY', 'SF']);
    expect(researchMerchant).toHaveBeenCalledTimes(3);
  });

  it('suggests only wines near the person or shipped to them, and everything when none are', async () => {
    const { app, places, sf, tx, sell } = await setup();
    const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');
    const neb = { grape: 'Nebbiolo', region: 'Piedmont', country: 'Italy', colour: 'red', source: 'lwin' as const };
    const priced = async (name: string, cents: number) => {
      const id = await createWine(db, { producer: name, name, ...neb });
      await db.query(`INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at) VALUES ($1, '*', $2, $2, $2, 1, 1, 30, NOW())`, [id, cents]);
      return id;
    };
    for (const n of ['Vietti', 'Bartolo', 'Conterno']) await as(request(app).post('/api/tastings')).send({ wineId: await priced(n, 5000), rating: 5 });
    const local = await priced('Vajra', 5000);
    const faraway = await priced('Cavallotto', 5000);
    await sell(local, sf, 5000);
    await sell(faraway, tx, 5000);

    const ids = async (near: string) => {
      const b = (await as(request(app).get(`/api/recommendations?near=${near}`))).body;
      return { ids: b.items.map((i: { wineId: number }) => i.wineId).sort(), near: b.near, first: b.items[0] };
    };
    await ids(PALO_ALTO);
    await places.drained();
    forgetRecommendationCandidates(db);
    const ca = await ids(PALO_ALTO);
    expect(ca.ids).toEqual([local]);
    expect(ca.near).toEqual({ applied: true, state: 'CA', pending: 0 });
    expect(ca.first.nearby).toMatchObject({ shop: 'SF', local: true, city: 'San Francisco' });
    // In Texas the other one; in Florida nothing is near, so everything, flagged as not applied.
    expect((await ids('30.27,-97.74,TX')).ids).toEqual([faraway]);
    const fl = await ids(',,FL');
    expect(fl.ids).toEqual([local, faraway].sort());
    expect(fl.near).toMatchObject({ applied: false, state: 'FL' });
  });
});
