import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { sanitizeListEntries } from '../src/llm/sanitize.js';
import { parseListText } from '../src/picks/listText.js';
import { firstAnswer, readListPages } from '../src/picks/picks.js';
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

  it('reads a lone high price as a bottle, even under "by the glass"', () => {
    expect(parseListText('BY THE GLASS\nVacheron, Sancerre 19\nRaveneau, Chablis 2021 420').map((e) => [e.glassCents, e.bottleCents])).toEqual([[1900, null], [null, 42000]]);
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

describe('asking readers', () => {
  const reader = (name: string, answer: () => Promise<string>) => Object.assign(new NullProvider(), { name, ask: vi.fn(answer) });
  const later = (ms: number, v: string) => () => new Promise<string>((r) => setTimeout(() => r(v), ms));

  it('takes the free answer when it comes in time, and asks the next reader only when the free one is slow or fails', async () => {
    const free = reader('free', later(5, 'free answer'));
    const paid = reader('paid', later(5, 'paid answer'));
    expect(await firstAnswer([free, paid], (p) => (p as typeof free).ask(), undefined, 50)).toEqual({ value: 'free answer', source: 'free' });
    expect(paid.ask).not.toHaveBeenCalled();

    const slow = reader('free', later(200, 'late'));
    expect(await firstAnswer([slow, paid], (p) => (p as typeof slow).ask(), undefined, 20)).toEqual({ value: 'paid answer', source: 'paid' });

    const broken = reader('free', () => Promise.reject(new Error('429')));
    expect((await firstAnswer([broken, paid], (p) => (p as typeof broken).ask(), undefined, 10_000)).source).toBe('paid');
    await expect(firstAnswer([broken], (p) => (p as typeof broken).ask())).rejects.toThrow('429');
  });

  it('asks the same reader a second time when the first try is slow, and takes whichever answers first', async () => {
    let n = 0;
    const gemini = reader('gemini', () => (++n === 1 ? later(500, 'stuck')() : later(5, 'second try')()));
    expect(await firstAnswer([gemini, gemini], (p) => (p as typeof gemini).ask(), undefined, 20)).toEqual({ value: 'second try', source: 'gemini' });
    expect(gemini.ask).toHaveBeenCalledTimes(2);
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
    const app = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
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
    const app = createApp({ db, provider, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
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

  it('reads a shelf photo with a vision model once, compares shelf prices with typical retail, and takes tags read on the phone', async () => {
    const readShelf = vi.fn().mockResolvedValue([
      { producer: 'GD Vajra', name: 'Barolo Albe', vintage: '2019', region: 'Barolo', country: '', grape: '', colour: 'red', style: '', section: '', glassCents: null, bottleCents: 3600, bottleMl: null, text: 'VAJRA BAROLO ALBE 36.00' },
    ]);
    const provider = Object.assign(new NullProvider(), { name: 'gemini', readShelf });
    const app = createApp({ db, provider, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
    const vajra = await priced({ producer: 'GD Vajra', name: 'Barolo Albe', sub_region: 'Barolo', ...neb }, 4000);
    const photo = { kind: 'shelf', imageBase64: Buffer.from('shelf photo').toString('base64'), mimeType: 'image/jpeg', text: 'VAJRA BAROLO ALBE 36.00' };

    const a = await as(request(app).post('/api/picks')).send(photo);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ kind: 'shelf', source: 'gemini', items: [{ wineId: vajra, match: 'matched', markup: 0.9, retailCents: 4000 }] });
    expect(readShelf.mock.calls[0]![2]).toBe('VAJRA BAROLO ALBE 36.00');
    await as(request(app).post('/api/picks')).send(photo);
    expect(readShelf).toHaveBeenCalledTimes(1);

    // Tags read on the phone: no photo, no model.
    const b = await as(request(app).post('/api/picks')).send({ kind: 'shelf', entries: [{ producer: 'GD Vajra', name: 'Barolo Albe', bottleCents: 4800 }] });
    expect(b.body).toMatchObject({ source: 'apple', items: [{ wineId: vajra, markup: 1.2 }] });

    readShelf.mockRejectedValue(new Error('model down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await as(request(app).post('/api/picks')).send({ ...photo, imageBase64: Buffer.from('another').toString('base64') })).status).toBe(502);
    const none = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
    expect((await as(request(none).post('/api/picks')).send({ ...photo, imageBase64: Buffer.from('third').toString('base64') })).status).toBe(503);
  });

  it("hands on each part's wines as soon as that part is read, while a slow part is still being read", async () => {
    const wine = (producer: string) => ({ producer, name: 'Cuvée', vintage: '', region: '', country: '', grape: '', colour: '', style: '', section: '', glassCents: null, bottleCents: 9000, bottleMl: null, text: producer });
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const gemini = Object.assign(new NullProvider(), {
      name: 'gemini',
      readWineList: vi.fn(async (text: string) => {
        if (text.includes('Slow')) await slow;
        return [wine(text.split('\n')[0]!)];
      }),
    });
    const page = [...Array(30)].map((_, i) => (i === 25 ? 'Slow line 90' : `Wine ${i} 90`)).join('\n');
    const handed: string[][] = [];
    const reading = readListPages(db, [page], [gemini], (entries) => handed.push(entries.map((e) => e.producer)));
    await vi.waitFor(() => expect(handed).toEqual([['Wine 0 90']]));
    release();
    const read = await reading;
    expect(handed).toEqual([['Wine 0 90'], ['Wine 20 90']]);
    expect(read.entries.map((e) => e.producer)).toEqual(['Wine 0 90', 'Wine 20 90']);
  });

  it('reads long lists in parts at once, Gemini first, and only reads a new page when one is added', async () => {
    const wine = (producer: string) => ({ producer, name: 'Cuvée', vintage: '', region: '', country: '', grape: '', colour: '', style: '', section: '', glassCents: null, bottleCents: 9000, bottleMl: null, text: producer });
    const main = Object.assign(new NullProvider(), {
      name: 'gemini',
      // Busy on the part that mentions Busy; otherwise one wine per part, named after its first line.
      readWineList: vi.fn(async (text: string) => {
        if (text.includes('Busy')) throw new Error('429');
        return [wine(text.split('\n')[0]!)];
      }),
    });
    const backup = Object.assign(new NullProvider(), { name: 'openrouter', readWineList: vi.fn(async (text: string) => [wine(`free ${text.split('\n')[0]}`)]) });
    const app = createApp({ db, provider: main, pickReaders: [main, backup], fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
    const page1 = [...Array(130)].map((_, i) => (i === 0 ? 'REDS' : i === 70 ? 'Busy line 90' : `Wine ${i} 90`)).join('\n');
    const a = await as(request(app).post('/api/picks')).send({ kind: 'list', pages: [page1] });
    expect(a.status).toBe(200);
    // 130 rows: seven parts; the fourth (with Busy) fell back to the free reader; later parts carry the heading.
    expect(main.readWineList).toHaveBeenCalledTimes(7);
    expect(backup.readWineList).toHaveBeenCalledTimes(1);
    expect(main.readWineList.mock.calls.map((c) => c[0].split('\n')[0])).toEqual(Array(7).fill('REDS'));
    expect(a.body.source).toBe('gemini+openrouter');
    expect(a.body.items).toHaveLength(7);

    const b = await as(request(app).post('/api/picks')).send({ kind: 'list', pages: [page1, 'WHITES\nVacheron Sancerre 70'] });
    expect(b.body.items).toHaveLength(8);
    expect(main.readWineList).toHaveBeenCalledTimes(8);
  });

  it('saves a list with its photos, lists it, opens it scored afresh, and deletes it', async () => {
    const app = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
    const other = (r: request.Test) => r.set('Authorization', 'Dev someone-else');
    await priced({ producer: 'Clape', name: 'Cornas', colour: 'red', grape: 'Syrah', source: 'lwin' }, 9000);
    const scan = await as(request(app).post('/api/picks')).send({ kind: 'list', pages: ['RED\nClape, Cornas 2019 34 / 160'] });
    const id = scan.body.pickId;
    expect((await as(request(app).get('/api/picks'))).body.saved).toEqual([]);

    expect((await as(request(app).patch(`/api/picks/${id}`)).send({ name: 'Rich Table' })).status).toBe(200);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect((await as(request(app).put(`/api/picks/${id}/photos`)).send({ photos: [{ base64: jpeg.toString('base64'), mimeType: 'image/jpeg' }] })).status).toBe(200);
    // Not someone else's to change or see.
    expect((await other(request(app).patch(`/api/picks/${id}`)).send({ name: 'Mine now' })).status).toBe(404);
    expect((await other(request(app).get(`/api/picks/${id}/photos/0`))).status).toBe(404);

    const list = await as(request(app).get('/api/picks'));
    expect(list.body.saved).toEqual([expect.objectContaining({ pickId: id, kind: 'list', name: 'Rich Table', wines: 1, photos: 1, topPick: expect.stringContaining('Clape') })]);
    const opened = await as(request(app).get(`/api/picks/${id}`));
    expect(opened.body).toMatchObject({ pickId: id, name: 'Rich Table', saved: true, photos: 1, items: [{ entry: { producer: 'Clape', glassCents: 3400, bottleCents: 16000 } }] });
    const photo = await as(request(app).get(`/api/picks/${id}/photos/0`));
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(photo.body)).toEqual(jpeg);

    expect((await as(request(app).delete(`/api/picks/${id}`))).status).toBe(204);
    expect((await as(request(app).get('/api/picks'))).body.saved).toEqual([]);
    expect((await as(request(app).get(`/api/picks/${id}`))).status).toBe(404);
  });

  it('runs as a job with a ref: answers at once, keeps going, and is collected later; the same ref runs once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const readWineList = vi.fn(async () => {
      await gate;
      return [{ producer: 'Clape', name: 'Cornas', vintage: '2019', region: '', country: '', grape: 'Syrah', colour: 'red', style: '', section: '', glassCents: 3400, bottleCents: null, bottleMl: null, text: '' }];
    });
    const provider = Object.assign(new NullProvider(), { name: 'gemini', readWineList });
    const app = createApp({ db, provider, pickReaders: [provider], fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, exposeInternals: true });
    const ref = 'list-job-0123456789abcdef';
    const a = await as(request(app).post('/api/picks')).send({ kind: 'list', pages: ['RED\nClape, Cornas 2019 34'], ref });
    expect(a.status).toBe(202);
    expect(a.body).toMatchObject({ ref, status: 'pending' });
    // Sent again (the app retrying after a dropped connection): still the one job.
    expect((await as(request(app).post('/api/picks')).send({ kind: 'list', pages: ['RED\nClape, Cornas 2019 34'], ref })).body.status).toBe('pending');
    expect((await as(request(app).get(`/api/scans/jobs/${ref}`))).body.status).toBe('pending');

    release();
    let job = { status: 'pending' } as { status: string; result?: { items: { entry: { producer: string } }[] } };
    for (let i = 0; i < 50 && job.status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      job = (await as(request(app).get(`/api/scans/jobs/${ref}`))).body;
    }
    expect(job.status).toBe('done');
    expect(job.result!.items[0]!.entry.producer).toBe('Clape');
    expect(readWineList).toHaveBeenCalledTimes(1);
    // Not someone else's to read.
    expect((await request(app).get(`/api/scans/jobs/${ref}`).set('Authorization', 'Dev someone-else')).status).toBe(404);
  });

  it('keeps lists and shelves not saved for 14 days by default (a setting), then forgets them', async () => {
    const app = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');
    const list = { kind: 'list', entries: [{ producer: 'Domaine Vacheron', name: 'Sancerre', colour: 'white', bottleCents: 9000 }] };
    const a = (await as(request(app).post('/api/picks')).send(list)).body.pickId;
    const b = (await as(request(app).post('/api/picks')).send(list)).body.pickId;
    await as(request(app).patch(`/api/picks/${b}`)).send({ name: 'Saved one' });
    let r = (await as(request(app).get('/api/picks'))).body;
    expect(r).toMatchObject({ keepDays: 14, recent: [{ pickId: a, kind: 'list', wines: 1 }], saved: [{ pickId: b }] });
    // 15 days on, the unsaved one is gone; the saved one stays.
    await db.query(`UPDATE pick_scans SET created_at = NOW() - INTERVAL '15 days'`);
    r = (await as(request(app).get('/api/picks'))).body;
    expect(r.recent).toEqual([]);
    expect(r.saved).toHaveLength(1);
    // Keep them 30 days instead.
    const c = (await as(request(app).post('/api/picks')).send(list)).body.pickId;
    await as(request(app).patch('/api/me')).send({ pickHistoryDays: 30 });
    await db.query(`UPDATE pick_scans SET created_at = NOW() - INTERVAL '20 days' WHERE pick_id = $1`, [c]);
    expect((await as(request(app).get('/api/picks'))).body).toMatchObject({ keepDays: 30, recent: [{ pickId: c }] });
  });
});
