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
const as = (who: string) => ({ Authorization: `Dev ${who}` });
const neb = { grape: 'Nebbiolo', region: 'Piedmont', country: 'Italy', colour: 'red', source: 'lwin' as const };

async function priced(w: Parameters<typeof createWine>[1], cents: number) {
  const id = await createWine(db, w);
  await db.query(
    `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at)
     VALUES ($1, '*', $2, $2, $2, 3, 3, 30, NOW())`, [id, cents]);
  return id;
}

describe('your taste', () => {
  it('shows the card, takes edits that change suggestions, and shares it with friends who see how alike they are', async () => {
    const a = app();
    const barolo = await priced({ producer: 'Vietti', name: 'Barolo Castiglione', sub_region: 'Barolo', ...neb }, 6000);
    const barbaresco = await priced({ producer: 'Produttori del Barbaresco', name: 'Barbaresco', sub_region: 'Barbaresco', ...neb }, 5000);
    const sb = await priced({ producer: 'Kim Crawford', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', grape: 'Sauvignon Blanc', colour: 'white', source: 'lwin' }, 1500);
    const vajra = await priced({ producer: 'GD Vajra', name: 'Barolo Albe', sub_region: 'Barolo', ...neb }, 5500);
    const chianti = await priced({ producer: 'Felsina', name: 'Chianti Classico', grape: 'Sangiovese', region: 'Tuscany', country: 'Italy', colour: 'red', source: 'lwin' }, 3000);
    for (const [who, wineId, rating] of [['ann', barolo, 5], ['ann', barbaresco, 4.5], ['ann', sb, 2], ['ben', barolo, 4.5], ['ben', vajra, 5], ['ben', sb, 2.5]] as const) {
      await request(a).post('/api/tastings').set(as(who)).send({ wineId, rating });
    }
    const card = (await request(a).get('/api/taste').set(as('ann'))).body;
    expect(card.rated).toBe(3);
    expect(card.grapes).toContain('Nebbiolo');
    expect(card.likes.length).toBeGreaterThan(0);
    expect(card.favorites.map((f: { wineId: number }) => f.wineId)).toEqual([barolo, barbaresco]);

    // Avoiding Nebbiolo pushes it out of the top suggestion.
    const before = (await request(a).get('/api/recommendations').set(as('ann'))).body.items.map((i: { wineId: number }) => i.wineId);
    expect(before[0]).toBe(vajra);
    const edited = (await request(a).put('/api/taste').set(as('ann')).send({ avoid: ['Nebbiolo'], likedFlavors: ['red_fruit'], budget: '20to40', budgetFixed: true })).body;
    expect(edited.edits).toMatchObject({ avoid: ['Nebbiolo'], likedFlavors: ['red_fruit'], budget: '20to40', budgetFixed: true });
    const after = (await request(a).get('/api/recommendations').set(as('ann'))).body.items.map((i: { wineId: number }) => i.wineId);
    expect(after[0]).toBe(chianti);
    await request(a).put('/api/taste').set(as('ann')).send({ avoid: [] });

    // Share: Ben opens Ann's link, sees her card (not her edits) and how alike they are, and adds her.
    const { code } = (await request(a).post('/api/taste/link').set(as('ann')).send({})).body;
    expect((await request(a).post('/api/taste/link').set(as('ann')).send({})).body.code).toBe(code);
    const seen = (await request(a).get(`/api/taste/cards/${code}`).set(as('ben'))).body;
    expect(seen).toMatchObject({ me: false, friend: false, card: { rated: 3 } });
    expect(seen.card).not.toHaveProperty('edits');
    expect(seen.comparison.similarity).toBeGreaterThan(60);
    expect(seen.comparison.bothLoved.map((w: { wineId: number }) => w.wineId)).toEqual([barolo]);
    expect(seen.comparison.theyLoveYouHavent.map((w: { wineId: number }) => w.wineId)).toEqual([barbaresco]);
    expect((await request(a).post(`/api/taste/cards/${code}/friend`).set(as('ann'))).status).toBe(400);
    await request(a).post(`/api/taste/cards/${code}/friend`).set(as('ben'));
    const annFriends = (await request(a).get('/api/taste/friends').set(as('ann'))).body.friends;
    expect(annFriends).toHaveLength(1);
    const benId = annFriends[0].userId;
    expect((await request(a).get(`/api/taste/friends/${benId}`).set(as('ann'))).body.comparison.theyLoveYouHavent.map((w: { wineId: number }) => w.wineId)).toEqual([vajra]);
    // Not friends: not visible.
    expect((await request(a).get(`/api/taste/friends/${benId}`).set(as('cat'))).status).toBe(404);
    // A new link stops the old one working.
    await request(a).post('/api/taste/link').set(as('ann')).send({ renew: true });
    expect((await request(a).get(`/api/taste/cards/${code}`).set(as('cat'))).status).toBe(404);
  });
});
