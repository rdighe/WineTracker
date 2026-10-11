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

  it('validates ratings in half steps', async () => {
    const wineId = await createWine(db, { producer: 'X', name: 'Y', source: 'user' });
    expect((await request(app()).post('/api/tastings').set('Authorization', 'Dev r').send({ wineId, rating: 4.3 })).status).toBe(400);
  });

  it('saves wines to a watch list', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'X', name: 'Y', source: 'user' });
    expect((await request(a).put(`/api/saved/${wineId}`).set('Authorization', 'Dev r').send({})).status).toBe(204);
    expect((await request(a).get('/api/saved').set('Authorization', 'Dev r')).body.saved).toHaveLength(1);
    expect((await request(a).delete(`/api/saved/${wineId}`).set('Authorization', 'Dev r')).status).toBe(204);
  });
});
