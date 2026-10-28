import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const app = () => createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });

describe('tastings API', () => {
  it('requires a user', async () => {
    expect((await request(app()).get('/api/tastings')).status).toBe(401);
  });

  it('logs a tasting with price paid, compares with market now, edits and deletes', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Opus One', name: '', source: 'lwin' });
    await db.query(
      `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at)
       VALUES ($1, '2019', 42000, 40000, 45000, 3, 2, 30, NOW())`,
      [wineId]
    );
    const created = await request(a).post('/api/tastings').set('Authorization', 'Dev rohan').send({
      wineId, vintage: '2019', rating: 4.5, notes: 'Great', tags: ['Dark Cherry', 'dark cherry!', '<b>cedar</b>'], pricePaid: 900, priceContext: 'restaurant', tastedOn: '2026-09-01',
    });
    expect(created.status).toBe(201);
    const list = await request(a).get('/api/tastings').set('Authorization', 'Dev rohan');
    expect(list.body.tastings[0]).toMatchObject({
      wine_id: wineId, rating: 4.5, tags: ['dark cherry', 'cedar'], paid_750_cents: 90000, market_now_cents: 42000, market_vintage_key: '2019', tasted_on: '2026-09-01',
    });
    // The restaurant price is stored but does not move the market price
    const obs = await db.query(`SELECT context, source_type FROM price_observations`);
    expect(obs.rows).toEqual([{ context: 'restaurant', source_type: 'user' }]);

    // Another user can't see or change it
    expect((await request(a).get('/api/tastings').set('Authorization', 'Dev mallory')).body.tastings).toEqual([]);
    const id = created.body.tastingId;
    expect((await request(a).patch(`/api/tastings/${id}`).set('Authorization', 'Dev mallory').send({ rating: 1 })).status).toBe(404);

    expect((await request(a).patch(`/api/tastings/${id}`).set('Authorization', 'Dev rohan').send({ rating: 4, pricePaid: null })).status).toBe(200);
    const after = await request(a).get('/api/tastings').set('Authorization', 'Dev rohan');
    expect(after.body.tastings[0]).toMatchObject({ rating: 4, price_paid_cents: null });
    expect((await db.query('SELECT COUNT(*)::int AS n FROM price_observations')).rows[0].n).toBe(0);

    expect((await request(a).delete(`/api/tastings/${id}`).set('Authorization', 'Dev rohan')).status).toBe(204);
    expect((await request(a).get('/api/me').set('Authorization', 'Dev rohan')).body).toMatchObject({ tastings: 0 });
  });

  it('records where a tasted wine was drunk, never for cellar bottles', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Geyserville', source: 'user' });
    const home = await request(a).post('/api/tastings').set('Authorization', 'Dev r').send({ wineId, rating: 4, setting: 'home' });
    expect(home.status).toBe(201);
    await request(a).post('/api/tastings').set('Authorization', 'Dev r').send({ wineId, kind: 'cellar', bottles: 2, setting: 'home', tastedOn: '2026-01-01' });
    expect((await request(a).post('/api/tastings').set('Authorization', 'Dev r').send({ wineId, setting: 'beach' })).status).toBe(400);
    const list = (await request(a).get('/api/tastings').set('Authorization', 'Dev r')).body.tastings;
    expect(list.map((t: { kind: string; setting: string | null }) => [t.kind, t.setting])).toEqual([['tasted', 'home'], ['cellar', null]]);
    await request(a).patch(`/api/tastings/${home.body.tastingId}`).set('Authorization', 'Dev r').send({ setting: 'restaurant' });
    await request(a).patch(`/api/tastings/${home.body.tastingId}`).set('Authorization', 'Dev r').send({ rating: 3.5 });
    expect((await request(a).get('/api/tastings').set('Authorization', 'Dev r')).body.tastings[0]).toMatchObject({ setting: 'restaurant', rating: 3.5 });
  });

  it('validates ratings in half steps', async () => {
    const wineId = await createWine(db, { producer: 'X', name: 'Y', source: 'user' });
    expect((await request(app()).post('/api/tastings').set('Authorization', 'Dev r').send({ wineId, rating: 4.3 })).status).toBe(400);
  });

  it('saves wines to a watch list', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'X', name: 'Y', source: 'user' });
    expect((await request(a).put(`/api/saved/${wineId}`).set('Authorization', 'Dev r').send({})).status).toBe(204);
    expect((await request(a).get('/api/saved').set('Authorization', 'Dev r')).body.saved).toEqual([expect.objectContaining({ wine_id: wineId, vintage_key: '*', image_url: null, colour: expect.any(String) })]);
    expect((await request(a).delete(`/api/saved/${wineId}`).set('Authorization', 'Dev r')).status).toBe(204);
  });
});

describe('removing a wine from the cellar', () => {
  const as = (r: request.Test, who = 'rohan') => r.set('Authorization', `Dev ${who}`);

  it('keeps the tasting records, and keeps notes written on the cellar entry as a tasting', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Lafleur', name: '', source: 'lwin' });
    const add = async (body: object) => (await as(request(a).post('/api/tastings')).send({ wineId, ...body })).body.tastingId as number;
    const bare = await add({ kind: 'cellar', bottles: 3, vintage: '2015', tastedOn: '2026-03-01' });
    const noted = await add({ kind: 'cellar', bottles: 1, vintage: '2016', rating: 4.5, notes: 'Bought at the estate' });
    const tasted = await add({ kind: 'tasted', vintage: '2015', rating: 5, notes: 'Violets', tastedOn: '2026-05-02' });

    expect((await as(request(a).post(`/api/tastings/${bare}/remove-from-cellar`))).status).toBe(200);
    expect((await as(request(a).post(`/api/tastings/${noted}/remove-from-cellar`))).body).toEqual({ kept: true });
    const left = (await as(request(a).get('/api/tastings'))).body.tastings;
    expect(left.map((t: { tasting_id: number; kind: string; bottles: number | null }) => [t.tasting_id, t.kind, t.bottles]).sort()).toEqual(
      [[noted, 'tasted', null], [tasted, 'tasted', null]].sort()
    );
    // Not a cellar entry (any more), or someone else's: nothing to remove.
    expect((await as(request(a).post(`/api/tastings/${tasted}/remove-from-cellar`))).status).toBe(400);
    expect((await as(request(a).post(`/api/tastings/${tasted}/remove-from-cellar`), 'someone-else')).status).toBe(404);
  });

  it('fixes a cellar entry added by mistake: vintage, bottles, price, and the wine itself', async () => {
    const a = app();
    const as = (r: request.Test) => r.set('Authorization', 'Dev fixer');
    const wrong = await createWine(db, { producer: 'Ridge', name: 'Geyserville', source: 'user' });
    const right = await createWine(db, { producer: 'Ridge', name: 'Lytton Springs', source: 'user' });
    const id = (await as(request(a).post('/api/tastings')).send({ wineId: wrong, vintage: '2019', kind: 'cellar', bottles: 2, pricePaid: 40 })).body.tastingId;
    expect((await as(request(a).patch(`/api/tastings/${id}`)).send({ wineId: right, vintage: '2020', bottles: 3, pricePaid: 45 })).status).toBe(200);
    const [t] = (await as(request(a).get('/api/tastings'))).body.tastings;
    expect(t).toMatchObject({ tasting_id: id, wine_id: right, vintage_key: '2020', bottles: 3, price_paid_cents: 4500, kind: 'cellar' });
    // The price paid moved with it: it counts for the right wine, not the wrong one.
    const { rows } = await db.query(`SELECT wine_id FROM price_observations WHERE source_type = 'user'`);
    expect(rows.map((r) => Number(r.wine_id))).toEqual([right]);
    expect((await as(request(a).patch(`/api/tastings/${id}`)).send({ wineId: 999999 })).status).toBe(404);
  });

  it('lets the date of any entry be changed', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    const id = (await as(request(a).post('/api/tastings')).send({ wineId, kind: 'cellar', bottles: 2 })).body.tastingId;
    expect((await as(request(a).patch(`/api/tastings/${id}`)).send({ tastedOn: '2025-12-24' })).status).toBe(200);
    const [t] = (await as(request(a).get('/api/tastings'))).body.tastings;
    expect(t).toMatchObject({ tasted_on: '2025-12-24', kind: 'cellar', bottles: 2 });
  });
});
