import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { buildProfile, explain, scoreWine } from '../src/recs/profile.js';
import { wineFeatures } from '../src/recs/features.js';
import { closeDb, resetDb, testDb } from './helpers.js';

describe('taste profile', () => {
  const f = (o: Record<string, string>) => wineFeatures({ wine_id: 1, display_name: '', producer: '', grape: '', colour: '', wine_type: '', region: '', sub_region: '', country: '', ...o });
  const barolo = f({ display_name: 'Vietti Barolo Castiglione', producer: 'Vietti', grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barolo', country: 'Italy' });
  const barbaresco = f({ display_name: 'Produttori Barbaresco', producer: 'Produttori del Barbaresco', grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barbaresco', country: 'Italy' });
  const sb = f({ display_name: 'Kim Crawford Sauvignon Blanc', producer: 'Kim Crawford', region: 'Marlborough', country: 'New Zealand' });

  it('infers features from the title when fields are missing', () => {
    expect(sb).toMatchObject({ grape: 'sauvignon blanc', colour: 'white', style: 'still', country: 'new zealand' });
    expect(f({ display_name: 'Pol Roger Brut Reserve' }).style).toBe('sparkling');
  });

  it('scores liked features up, disliked down, and explains', () => {
    const p = buildProfile([
      { features: barolo, rating: 5, priceCents: 6000 },
      { features: barbaresco, rating: 4.5, priceCents: 5000 },
      { features: sb, rating: 2, priceCents: 1500 },
    ]);
    const other = f({ display_name: 'GD Vajra Barolo Albe', producer: 'GD Vajra', grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barolo', country: 'Italy' });
    const otherSb = f({ display_name: 'Cloudy Bay Sauvignon Blanc', producer: 'Cloudy Bay', region: 'Marlborough', country: 'New Zealand' });
    const a = scoreWine(p, other, 5500);
    const b = scoreWine(p, otherSb, 3000);
    expect(a.score).toBeGreaterThan(0);
    expect(b.score).toBeLessThan(0);
    expect(explain(a.contributions)[0]).toMatch(/You rated 2 Nebbiolo wines highly|You rated 1 Barolo wine highly/);
    // Way above the usual price range costs points
    expect(scoreWine(p, other, 60000).score).toBeLessThan(a.score);
  });
});

describe('recommendations API', () => {
  let db: pg.Pool;
  beforeEach(async () => {
    db = await testDb();
    await resetDb(db);
  });
  afterAll(closeDb);

  async function priced(w: Parameters<typeof createWine>[1], cents: number, merchants = 1) {
    const id = await createWine(db, w);
    await db.query(
      `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at)
       VALUES ($1, '*', $2, $2, $2, 1, $3, 30, NOW())`,
      [id, cents, merchants]
    );
    return id;
  }

  it('starts with popular wines, then personalizes after a few ratings', async () => {
    const fetcher = new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() });
    const app = createApp({ db, provider: new NullProvider(), fetcher, auth: { allowDev: true } });
    const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');
    const neb = { grape: 'Nebbiolo', region: 'Piedmont', country: 'Italy', colour: 'red', source: 'lwin' as const };
    const t1 = await priced({ producer: 'Vietti', name: 'Barolo Castiglione', sub_region: 'Barolo', ...neb }, 6000, 3);
    const t2 = await priced({ producer: 'Produttori del Barbaresco', name: 'Barbaresco', sub_region: 'Barbaresco', ...neb }, 5000, 2);
    const t3 = await priced({ producer: 'Kim Crawford', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', source: 'crawl' }, 1500, 5);
    const target = await priced({ producer: 'GD Vajra', name: 'Barolo Albe', sub_region: 'Barolo', ...neb }, 5500, 1);
    const dud = await priced({ producer: 'Cloudy Bay', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', source: 'crawl' }, 3000, 4);

    const cold = await as(request(app).get('/api/recommendations'));
    expect(cold.body.mode).toBe('popular');
    expect(cold.body.items[0].wineId).toBe(t3); // most shops

    for (const [wineId, rating] of [[t1, 5], [t2, 4.5], [t3, 2]] as const) {
      expect((await as(request(app).post('/api/tastings')).send({ wineId, rating, pricePaid: 40, priceContext: 'restaurant' })).status).toBe(201);
    }
    const recs = await as(request(app).get('/api/recommendations'));
    expect(recs.body.mode).toBe('profile');
    const ids = recs.body.items.map((i: { wineId: number }) => i.wineId);
    expect(ids[0]).toBe(target);
    expect(ids).not.toContain(dud);
    expect(ids).not.toContain(t1); // already tasted
    expect(recs.body.items[0].reasons.length).toBeGreaterThan(0);
  });
});
