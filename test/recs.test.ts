import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { buildProfile, explain, scoreWine } from '../src/recs/profile.js';
import { wineCategory, wineFeatures } from '../src/recs/features.js';
import { closeDb, resetDb, testDb } from './helpers.js';

describe('taste profile', () => {
  const f = (o: Record<string, string>) => wineFeatures({ wine_id: 1, display_name: '', producer: '', grape: '', colour: '', wine_type: '', region: '', sub_region: '', country: '', ...o });
  const barolo = f({ display_name: 'Vietti Barolo Castiglione', producer: 'Vietti', grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barolo', country: 'Italy' });
  const barbaresco = f({ display_name: 'Produttori Barbaresco', producer: 'Produttori del Barbaresco', grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barbaresco', country: 'Italy' });
  const sb = f({ display_name: 'Kim Crawford Sauvignon Blanc', producer: 'Kim Crawford', region: 'Marlborough', country: 'New Zealand' });

  it('infers features from the title when fields are missing', () => {
    expect(sb).toMatchObject({ grape: 'sauvignon blanc', colour: 'white', style: 'still', country: 'new zealand' });
    expect(f({ display_name: 'Pol Roger Brut Reserve' }).style).toBe('sparkling');
    expect(f({ display_name: 'Vietti, Barolo', sub_region: 'Barolo', colour: 'red' }).grape).toBe('nebbiolo');
    expect(f({ display_name: 'Raveneau, Chablis Premier Cru', sub_region: 'Chablis', colour: 'white' }).grape).toBe('chardonnay');
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
    expect(explain(a.contributions)[0]).toMatch(/^Tastes of what you like: /);
    expect(explain(a.contributions)[1]).toMatch(/^You rated (2 Nebbiolo wines|1 Barolo wine|2 Piedmont wines) highly$/);
    expect(explain([{ kind: 'country', value: 'italy', amount: 1, liked: 2 }])).toEqual(['You rated 2 wines from Italy highly']);
    // Way above the usual price range costs points
    expect(scoreWine(p, other, 60000).score).toBeLessThan(a.score);
  });
});

describe('flavour and category', () => {
  const f = (o: Record<string, string>, notes?: { descriptors?: string[]; text?: string }) =>
    wineFeatures({ wine_id: 1, display_name: '', producer: '', grape: '', colour: '', wine_type: '', region: '', sub_region: '', country: '', ...o }, notes);

  it('recommends by flavour before region', () => {
    const cornas = f({ display_name: 'Clape Cornas', grape: 'Syrah', region: 'Rhone', sub_region: 'Cornas', country: 'France', colour: 'red' }, { descriptors: ['black pepper', 'olive', 'blackberry'] });
    const crozes = f({ display_name: 'Graillot Crozes-Hermitage', grape: 'Syrah', region: 'Rhone', sub_region: 'Crozes-Hermitage', country: 'France', colour: 'red' }, { text: 'Peppery, smoked meat and black fruit.' });
    const sancerre = f({ display_name: 'Vacheron Sancerre', grape: 'Sauvignon Blanc', region: 'Loire', sub_region: 'Sancerre', country: 'France', colour: 'white' }, { descriptors: ['lemon', 'grass', 'chalk'] });
    const p = buildProfile([
      { features: cornas, rating: 5, priceCents: 6000 },
      { features: crozes, rating: 4.5, priceCents: 4000 },
      { features: sancerre, rating: 2.5, priceCents: 3500 },
    ]);
    // A peppery Washington Syrah vs a honeyed white from the same corner of the Rhone.
    const washington = f({ display_name: 'Cayuse Cailloux Syrah', grape: 'Syrah', region: 'Washington', country: 'USA', colour: 'red' }, { descriptors: ['black pepper', 'olive', 'smoked meat'] });
    const rhoneWhite = f({ display_name: 'Chave Hermitage Blanc', grape: 'Marsanne', region: 'Rhone', sub_region: 'Hermitage', country: 'France', colour: 'white' }, { descriptors: ['honey', 'apricot', 'almond'] });
    const w = scoreWine(p, washington, 5000);
    expect(w.score).toBeGreaterThan(scoreWine(p, rhoneWhite, 5000).score);
    expect(explain(w.contributions)[0]).toMatch(/^Tastes of what you like: .*(black fruit|spicy|savory)/);
  });

  it('falls back to the grape\'s typical flavours without notes', () => {
    expect(Object.keys(f({ display_name: 'Some Sancerre', grape: 'Sauvignon Blanc' }).flavours!)).toEqual(expect.arrayContaining(['citrus', 'herbal']));
    expect(Object.keys(f({ display_name: 'X' }, { descriptors: ['blackberry', 'graphite'] }).flavours!).sort()).toEqual(['black_fruit', 'mineral']);
  });

  it('files sparkling, rosé, sweet and fortified wines under "other", and reads colour from the appellation', () => {
    expect(wineCategory(f({ display_name: 'Krug Grande Cuvee Champagne', colour: 'white' }))).toBe('other');
    expect(wineCategory(f({ display_name: 'Domaine Ott Rose', colour: 'rose' }))).toBe('other');
    expect(wineCategory(f({ display_name: 'Chateau Climens Sauternes', colour: 'white' }))).toBe('other');
    expect(wineCategory(f({ display_name: 'Taylor Fladgate 20 Year Tawny Port' }))).toBe('other');
    expect(wineCategory(f({ display_name: 'Chateau Smith Haut Lafitte - Pessac', sub_region: 'Pessac-Leognan' }))).toBe('red');
    expect(wineCategory(f({ display_name: 'Fontaine Gagnard Pommard Clos De Rugiens 1er Cru' }))).toBe('red');
    expect(wineCategory(f({ display_name: 'Raveneau Chablis', colour: 'white' }))).toBe('white');
    expect(wineCategory(f({ display_name: 'Mystery Cuvee' }))).toBe('');
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

  it('suggests nothing until a few ratings, then personalizes', async () => {
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
    expect(cold.body).toEqual({ mode: 'locked', rated: 0, needed: 3, items: [] });

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
    // What the app's photo-first cards need: the style and the reference photo (none yet).
    expect(recs.body.items[0]).toMatchObject({ colour: expect.any(String), wineType: expect.any(String), imageUrl: null });
  });

  it('filters red / white / other, and leaves out non-wines and wines nobody has in stock', async () => {
    const fetcher = new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() });
    const app = createApp({ db, provider: new NullProvider(), fetcher, auth: { allowDev: true } });
    const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');
    const rated = [
      await priced({ producer: 'Vietti', name: 'Barolo', grape: 'Nebbiolo', colour: 'red', source: 'lwin' }, 6000),
      await priced({ producer: 'Raveneau', name: 'Chablis', grape: 'Chardonnay', colour: 'white', source: 'lwin' }, 9000),
      await priced({ producer: 'Bollinger', name: 'Special Cuvee Champagne', colour: 'white', wine_type: 'sparkling', source: 'lwin' }, 7000),
    ];
    for (const wineId of rated) expect((await as(request(app).post('/api/tastings')).send({ wineId, rating: 4.5 })).status).toBe(201);
    const red = await priced({ producer: 'GD Vajra', name: 'Barolo Albe', grape: 'Nebbiolo', colour: 'red', source: 'lwin' }, 5500);
    const white = await priced({ producer: 'Dauvissat', name: 'Chablis', grape: 'Chardonnay', colour: 'white', source: 'lwin' }, 8000);
    const fizz = await priced({ producer: 'Krug', name: 'Grande Cuvee Champagne', colour: 'white', source: 'lwin' }, 7500);
    const rose = await priced({ producer: 'Domaine Tempier', name: 'Bandol Rose', colour: 'rose', source: 'lwin' }, 5000);
    const whiskey = await priced({ producer: '', name: 'High West Bourbon Barrel Nebbiolo', grape: 'Nebbiolo', colour: 'red', source: 'crawl' }, 6000);
    const soldOut = await priced({ producer: 'Giacosa', name: 'Barolo Falletto', grape: 'Nebbiolo', colour: 'red', source: 'lwin' }, 30000);
    await db.query(`UPDATE wine_prices SET out_of_stock_only = true WHERE wine_id = $1`, [soldOut]);

    const ids = async (colour?: string) =>
      (await as(request(app).get(`/api/recommendations${colour ? `?colour=${colour}` : ''}`))).body.items.map((i: { wineId: number }) => i.wineId).sort();
    expect(await ids('red')).toEqual([red]);
    expect(await ids('white')).toEqual([white]);
    expect(await ids('other')).toEqual([fizz, rose].sort());
    expect(await ids('rose')).toEqual([fizz, rose].sort());
    const all = await ids();
    expect(all).not.toContain(whiskey);
    expect(all).not.toContain(soldOut);
  });

  it('takes turns between every liked style, and filters by one style', async () => {
    const fetcher = new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() });
    const app = createApp({ db, provider: new NullProvider(), fetcher, auth: { allowDev: true } });
    const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');
    const neb = { grape: 'Nebbiolo', region: 'Piedmont', country: 'Italy', colour: 'red', source: 'lwin' as const };
    const rated: [number, number][] = [
      [await priced({ producer: 'Vietti', name: 'Barolo Castiglione', ...neb }, 6000), 5],
      [await priced({ producer: 'Produttori del Barbaresco', name: 'Barbaresco', ...neb }, 5000), 5],
      [await priced({ producer: 'Raveneau', name: 'Chablis', grape: 'Chardonnay', colour: 'white', source: 'lwin' }, 9000), 3.5],
      [await priced({ producer: 'Bollinger', name: 'Special Cuvee Champagne', colour: 'white', wine_type: 'sparkling', source: 'lwin' }, 7000), 4],
      [await priced({ producer: 'Domaine Ott', name: 'Rose', colour: 'rose', source: 'lwin' }, 4000), 1.5],
    ];
    for (const [wineId, rating] of rated) expect((await as(request(app).post('/api/tastings')).send({ wineId, rating })).status).toBe(201);
    // Many reds that match the profile well, one white, one sparkling, one rosé (a style the user disliked).
    const reds = [];
    for (const p of ['GD Vajra', 'Giacosa', 'Oddero', 'Cavallotto', 'Massolino', 'Brovia']) reds.push(await priced({ producer: p, name: 'Barolo', ...neb }, 5500));
    const white = await priced({ producer: 'Dauvissat', name: 'Chablis', grape: 'Chardonnay', colour: 'white', source: 'lwin' }, 8000);
    const fizz = await priced({ producer: 'Krug', name: 'Grande Cuvee Champagne', colour: 'white', wine_type: 'sparkling', source: 'lwin' }, 7500);
    const rose = await priced({ producer: 'Tempier', name: 'Bandol Rose', colour: 'rose', source: 'lwin' }, 5000);

    const all = (await as(request(app).get('/api/recommendations'))).body;
    expect(all.styles).toEqual(['red', 'sparkling', 'white']);
    const first3 = all.items.slice(0, 3).map((i: { wineId: number }) => i.wineId);
    expect(first3[0]).toBeOneOf(reds);
    expect(first3.slice(1).sort()).toEqual([white, fizz].sort());
    expect(all.items.map((i: { wineId: number }) => i.wineId)).not.toContain(rose);

    const only = async (style: string) => (await as(request(app).get(`/api/recommendations?style=${style}`))).body.items.map((i: { wineId: number; style: string }) => [i.wineId, i.style]);
    expect(await only('sparkling')).toEqual([[fizz, 'sparkling']]);
    expect(await only('white')).toEqual([[white, 'white']]);
    // A style the user disliked still lists when asked for.
    expect(await only('rose')).toEqual([[rose, 'rose']]);
  });
});
