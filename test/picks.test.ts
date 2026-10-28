import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { sanitizeListEntries } from '../src/llm/sanitize.js';
import { parseListText } from '../src/picks/listText.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { forgetRecommendationCandidates } from '../src/recs/recommend.js';
import { closeDb, resetDb, testDb } from './helpers.js';

describe('reading a wine list by rules', () => {
  const LIST = `WINES BY THE GLASS
SPARKLING
Pierre Peters, Cuvée de Réserve Blanc de Blancs NV 28 / 112
WHITE
2022 Domaine Vacheron, Sancerre 19 | 76
RED
102 Clape, Cornas 2019 34
Produttori del Barbaresco
Barbaresco 2019 $22
COCKTAILS
Negroni 16
BOTTLES
Ridge, Monte Bello 2016 395
Domaine Tempier Bandol Rosé 2023 half bottle 48`;

  it('finds wines, vintages, glass and bottle prices, headings, sizes; skips cocktails and bin numbers', () => {
    const rows = parseListText(LIST).map((e) => [e.producer, e.name, e.vintage, e.section, e.glassCents, e.bottleCents, e.bottleMl]);
    expect(rows).toEqual([
      ['Pierre Peters', 'Cuvée de Réserve Blanc de Blancs', 'NV', 'SPARKLING', 2800, 11200, null],
      ['Domaine Vacheron', 'Sancerre', '2022', 'WHITE', 1900, 7600, null],
      ['Clape', 'Cornas', '2019', 'RED', 3400, null, null],
      ['Produttori del Barbaresco', 'Barbaresco', '2019', 'RED', 2200, null, null],
      ['Ridge', 'Monte Bello', '2016', 'BOTTLES', null, 39500, null],
      ['', 'Domaine Tempier Bandol Rosé', '2023', 'BOTTLES', null, 4800, 375],
    ]);
  });

  it('splits two columns of a list on one row', () => {
    const rows = parseListText('Clape, Cornas 2019 140 | Vietti, Barolo 2018 160').map((e) => [e.producer, e.bottleCents]);
    expect(rows).toEqual([['Clape', 14000], ['Vietti', 16000]]);
  });

  it('checks what a model read', () => {
    expect(sanitizeListEntries({ wines: [
      { producer: 'Clape', name: 'Cornas', vintage: '2019', colour: 'Red', glass_price: '$34', bottle_price: null, bottle_ml: 750 },
      { producer: '', name: '' },
      { name: 'Barolo', vintage: 'old', style: 'sparkling-ish', bottle_price: 'market price', bottle_ml: 1500 },
    ] })).toEqual([
      expect.objectContaining({ producer: 'Clape', vintage: '2019', colour: 'red', glassCents: 3400, bottleCents: null, bottleMl: null }),
      expect.objectContaining({ name: 'Barolo', vintage: '', style: '', bottleCents: null, bottleMl: 1500 }),
    ]);
    expect(sanitizeListEntries('no')).toBeNull();
  });
});

describe('picks API', () => {
  let db: pg.Pool;
  beforeEach(async () => {
    db = await testDb();
    await resetDb(db);
    forgetRecommendationCandidates(db);
  });
  afterAll(closeDb);

  const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');
  const neb = { grape: 'Nebbiolo', region: 'Piedmont', country: 'Italy', colour: 'red', source: 'lwin' as const };
  async function priced(w: Parameters<typeof createWine>[1], cents: number) {
    const id = await createWine(db, w);
    await db.query(
      `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at)
       VALUES ($1, '*', $2, $2, $2, 1, 1, 30, NOW())`,
      [id, cents]
    );
    return id;
  }
  const entry = (o: Record<string, unknown>) => ({ producer: '', name: '', text: '', ...o });

  it('ranks a list for the palate, flags markup, and leaves unknown wines as best guesses', async () => {
    const app = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const vietti = await priced({ producer: 'Vietti', name: 'Barolo Castiglione', sub_region: 'Barolo', ...neb }, 6000);
    const produttori = await priced({ producer: 'Produttori del Barbaresco', name: 'Barbaresco', sub_region: 'Barbaresco', ...neb }, 5000);
    const sb = await priced({ producer: 'Kim Crawford', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', source: 'crawl' }, 1500);
    const vajra = await priced({ producer: 'GD Vajra', name: 'Barolo Albe', sub_region: 'Barolo', ...neb }, 4000);
    const cloudy = await priced({ producer: 'Cloudy Bay', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', source: 'crawl' }, 3000);

    const list = { kind: 'list', entries: [
      entry({ producer: 'Cloudy Bay', name: 'Sauvignon Blanc', colour: 'white', glassCents: 1800, bottleCents: 7000 }),
      entry({ producer: 'GD Vajra', name: 'Barolo Albe', vintage: '2019', bottleCents: 11000 }),
      // Not in the catalog: the heading and appellation still say Nebbiolo.
      entry({ producer: 'Cascina Fontana', name: 'Langhe Nebbiolo', section: 'Piedmont reds', bottleCents: 6500 }),
      entry({ producer: 'Vietti', name: 'Barolo Castiglione', glassCents: 3000, bottleCents: 15000 }),
    ] };

    // Fewer than 3 ratings: no scores, the best value first.
    const locked = await as(request(app).post('/api/picks')).send(list);
    expect(locked.status).toBe(200);
    expect(locked.body).toMatchObject({ mode: 'locked', source: 'apple', rated: 0 });
    expect(locked.body.items[0]).toMatchObject({ wineId: cloudy, markup: 2.33, glassMarkup: 3, score: null });

    for (const [wineId, rating] of [[vietti, 5], [produttori, 4.5], [sb, 2]] as const) {
      await as(request(app).post('/api/tastings')).send({ wineId, rating });
    }
    const r = await as(request(app).post('/api/picks')).send(list);
    expect(r.body.mode).toBe('profile');
    const byName = Object.fromEntries(r.body.items.map((i: { entry: { producer: string } }) => [i.entry.producer, i]));
    // Their own 5 leads; the unknown Nebbiolo outranks the Sauvignon Blanc they'd likely not enjoy.
    expect(r.body.items.map((i: { entry: { producer: string } }) => i.entry.producer)).toEqual(['Vietti', 'GD Vajra', 'Cascina Fontana', 'Cloudy Bay']);
    expect(byName.Vietti).toMatchObject({ match: 'matched', myRating: 5, markup: 2.5, glassMarkup: 2.5, reasons: expect.arrayContaining(['You rated it 5']) });
    expect(byName['GD Vajra']).toMatchObject({ match: 'matched', wineId: vajra, retailCents: 4000, retailVintage: '*', markup: 2.75 });
    expect(byName['Cascina Fontana']).toMatchObject({ match: 'guess', wineId: null, markup: null, style: 'red' });
    expect(byName['Cascina Fontana'].score).toBeGreaterThan(byName['Cloudy Bay'].score);
    expect(byName['Cascina Fontana'].reasons.join(' ')).toMatch(/Nebbiolo|Piedmont|Tastes of what you like/i);
  });

  it('reads list text with a model once, then reuses it, and falls back to rules', async () => {
    const readWineList = vi.fn().mockResolvedValue([
      { producer: 'Clape', name: 'Cornas', vintage: '2019', region: 'Cornas', country: 'France', grape: 'Syrah', colour: 'red', style: 'still', section: 'Red', glassCents: 3400, bottleCents: null, bottleMl: null, text: 'Clape, Cornas 2019 34' },
    ]);
    const provider = Object.assign(new NullProvider(), { name: 'gemini', readWineList });
    const app = createApp({ db, provider, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const text = 'RED\nClape, Cornas 2019 34';
    const a = await as(request(app).post('/api/picks')).send({ kind: 'list', text });
    expect(a.body).toMatchObject({ source: 'gemini', items: [{ entry: { producer: 'Clape', glassCents: 3400 }, match: 'guess' }] });
    const b = await as(request(app).post('/api/picks')).send({ kind: 'list', text });
    expect(b.body.source).toBe('gemini');
    expect(readWineList).toHaveBeenCalledTimes(1);

    readWineList.mockRejectedValue(new Error('busy'));
    const c = await as(request(app).post('/api/picks')).send({ kind: 'list', text: 'WHITE\n2022 Domaine Vacheron, Sancerre 19 | 76' });
    expect(c.body).toMatchObject({ source: 'rules', items: [{ entry: { producer: 'Domaine Vacheron', glassCents: 1900, bottleCents: 7600 } }] });

    // What the phone read, plus a part it couldn't.
    readWineList.mockResolvedValue([{ producer: 'Ridge', name: 'Monte Bello', vintage: '2016', region: '', country: '', grape: '', colour: '', style: '', section: '', glassCents: null, bottleCents: 39500, bottleMl: null, text: '' }]);
    const d = await as(request(app).post('/api/picks')).send({ kind: 'list', entries: [{ producer: 'Clape', name: 'Cornas', glassCents: 3400 }], text: 'BOTTLES\nRidge, Monte Bello 2016 395' });
    expect(d.body.source).toBe('apple+gemini');
    expect(d.body.items.map((i: { entry: { producer: string } }) => i.entry.producer).sort()).toEqual(['Clape', 'Ridge']);

    expect((await as(request(app).post('/api/picks')).send({ kind: 'list' })).status).toBe(400);
  });
});
