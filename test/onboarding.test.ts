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

const app = () => createApp({ db, provider: new NullProvider(), pickJev: {}, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
const as = { Authorization: 'Dev newbie' };

describe('the taste quiz', () => {
  it('is offered once, and its answers unlock suggestions said as what you said', async () => {
    const a = app();
    const first = (await request(a).get('/api/onboarding').set(as)).body;
    expect(first).toMatchObject({ doneAt: null, tastings: 0, rated: 0, styles: [], budget: null, seeds: {} });
    expect(first.archetypes.length).toBeGreaterThanOrEqual(12);
    expect(first.archetypes.find((x: { key: string }) => x.key === 'champagne').style).toBe('sparkling');

    const nebbiolo = await createWine(db, { producer: 'Vietti', name: 'Barolo Castiglione', sub_region: 'Barolo', region: 'Piedmont', country: 'Italy', grape: 'Nebbiolo', colour: 'red', source: 'lwin' });
    const sauv = await createWine(db, { producer: 'Cloudy Bay', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', grape: 'Sauvignon Blanc', colour: 'white', source: 'lwin' });
    for (const [id, cents] of [[nebbiolo, 6000], [sauv, 2800]]) {
      await db.query(
        `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at)
         VALUES ($1, '*', $2, $2, $2, 3, 3, 30, NOW())`, [id, cents]);
    }
    // Locked before the quiz.
    expect((await request(a).get('/api/recommendations').set(as)).body.mode).toBe('locked');

    const saved = await request(a).put('/api/onboarding').set(as).send({
      styles: ['red', 'white'], budget: '40to80', done: true,
      seeds: { barolo: 'love', 'burgundy-pinot': 'love', 'nz-sauv': 'dislike', 'napa-cab': 'fine', port: 'unknown' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ styles: ['red', 'white'], budget: '40to80', skipped: false, seeds: { barolo: 'love', port: 'unknown' } });
    expect(saved.body.doneAt).toBeTruthy();
    expect((await request(a).put('/api/onboarding').set(as).send({ seeds: { nope: 'love' } })).status).toBe(400);

    const recs = (await request(a).get('/api/recommendations').set(as)).body;
    expect(recs.mode).toBe('profile');
    expect(recs.items[0].wineId).toBe(nebbiolo);
    expect(recs.items[0].reasons.join(' ')).toMatch(/You said you like|Tastes of what you like/);
    expect(recs.items[0].reasons.join(' ')).not.toMatch(/You rated/);
  });

  it('can be skipped, and is remembered', async () => {
    const a = app();
    await request(a).put('/api/onboarding').set(as).send({ skipped: true, done: true });
    expect((await request(a).get('/api/onboarding').set(as)).body).toMatchObject({ skipped: true });
  });
});
