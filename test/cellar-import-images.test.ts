import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import { findWineImage, isWhitePackshot } from '../src/catalog/images.js';
import { createWine } from '../src/catalog/wines.js';
import { importVivino, parseCsv, readRows } from '../src/imports/vivino.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { CATALOG } from './fixtures/catalog.js';
import { closeDb, resetDb, testDb } from './helpers.js';

const db = await testDb();
const ids = new Map<string, number>();
let userId: number;

beforeAll(async () => {
  await resetDb(db);
  for (const { key, ...w } of CATALOG) ids.set(key, await createWine(db, w));
  const { rows } = await db.query(`INSERT INTO users (auth_sub, display_name) VALUES ('dev:importer', 'importer') RETURNING user_id`);
  userId = rows[0].user_id;
});
afterAll(closeDb);

const app = () => createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });

describe('CSV parsing', () => {
  it('handles quotes, embedded separators and newlines, BOM, and ; separated files', () => {
    expect(parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line\nbreak"\n')).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'line\nbreak']]);
    expect(parseCsv('Winery;Wine name\nRidge;Monte Bello\n')).toEqual([['Winery', 'Wine name'], ['Ridge', 'Monte Bello']]);
  });

  it('finds columns by name, rounds ratings to half points, and ignores the community average', () => {
    const csv = [
      'Wine name,Winery,Average rating,Vintage,Your rating,Your review,Scan date,Wine type',
      'Monte Bello,Ridge Vineyards,4.6,2018,4.2,"Cassis, graphite",2024-05-01 19:20:00,Red wine',
      'Brut,Veuve Clicquot,4.1,N.V.,,,2024-06-02,Sparkling',
      ',,,,,,,',
    ].join('\n');
    const { rows, total } = readRows(csv);
    expect(total).toBe(2); // the all-empty row isn't a row
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ producer: 'Ridge Vineyards', name: 'Monte Bello', vintage: '2018', rating: 4, review: 'Cassis, graphite', tastedOn: '2024-05-01', colour: 'red' });
    expect(rows[1]).toMatchObject({ vintage: 'NV', rating: null });
  });
});

describe('Vivino import', () => {
  const csv = [
    'Winery,Wine name,Vintage,Region,Country,Your rating,Your review,Scan date,User cellar count',
    'Ridge Vineyards,Monte Bello,2018,Santa Cruz Mountains,United States,4.5,Stunning,2024-03-10,',
    'Domaine Inconnu,Cuvée Mystère,2020,Loire,France,3.5,,2024-04-01,',
    'Opus One,,2019,Napa Valley,United States,,,2024-05-01,3',
  ].join('\n');

  it('matches known wines, adds unknown ones as the user\'s own, and keeps cellar bottles apart', async () => {
    const s = await importVivino(db, userId, csv);
    expect(s).toMatchObject({ rows: 3, imported: 3, alreadyImported: 0, matched: 2, addedWines: 1, addedNames: ['Domaine Inconnu Cuvée Mystère'] });
    const { rows } = await db.query(`SELECT wine_id, vintage_key, rating::float, notes, kind, bottles, to_char(tasted_on, 'YYYY-MM-DD') AS d FROM tastings WHERE user_id = $1 ORDER BY tasted_on`, [userId]);
    expect(rows[0]).toMatchObject({ wine_id: ids.get('ridge-mb'), vintage_key: '2018', rating: 4.5, notes: 'Stunning', kind: 'tasted', d: '2024-03-10' });
    expect(rows[2]).toMatchObject({ wine_id: ids.get('opus-one'), kind: 'cellar', bottles: 3, rating: null });
  });

  it('adds nothing when the same file is imported again', async () => {
    const s = await importVivino(db, userId, csv);
    expect(s).toMatchObject({ imported: 0, alreadyImported: 3 });
  });

  it('rejects a file that is not a wine list', async () => {
    const r = await request(app()).post('/api/import/vivino').set('Authorization', 'Dev someone').send({ csv: 'date,amount\n2024-01-01,5\n' });
    expect(r.status).toBe(400);
  });
});

describe('cellar vs tasted', () => {
  it('records bottles for cellar entries and lists the kind', async () => {
    const a = app();
    const as = (r: request.Test) => r.set('Authorization', 'Dev cellarer');
    const wineId = ids.get('caymus-ss')!;
    expect((await as(request(a).post('/api/tastings')).send({ wineId, vintage: '2019', kind: 'cellar', bottles: 6, pricePaid: 180 })).status).toBe(201);
    expect((await as(request(a).post('/api/tastings')).send({ wineId, vintage: '2018', rating: 4 })).status).toBe(201);
    const list = (await as(request(a).get('/api/tastings'))).body.tastings;
    expect(list.map((t: { kind: string; bottles: number | null }) => [t.kind, t.bottles]).sort()).toEqual([['cellar', 6], ['tasted', null]]);
  });
});

describe('reference photos', () => {
  const packshot = (bg: string, w = 400, h = 600) =>
    sharp({ create: { width: w, height: h, channels: 3, background: bg } })
      .composite([{ input: { create: { width: Math.round(w / 4), height: Math.round(h * 0.8), channels: 3, background: '#3b0a1a' } }, gravity: 'center' }])
      .jpeg()
      .toBuffer();

  it('accepts a bottle on white and rejects other backgrounds and banners', async () => {
    expect(await isWhitePackshot(await packshot('#ffffff'))).toBe(true);
    expect(await isWhitePackshot(await packshot('#5a4a3a'))).toBe(false);
    expect(await isWhitePackshot(await packshot('#ffffff', 900, 300))).toBe(false);
  });

  it('prefers the same wine, falls back to the producer only for the same colour, and skips non-white photos', async () => {
    const m = (await db.query(`INSERT INTO merchants (domain, name) VALUES ('shop.test', 'Shop') RETURNING merchant_id`)).rows[0].merchant_id;
    const listing = (url: string, wineId: number, image: string, vintage: string | null) =>
      db.query(`INSERT INTO listings (merchant_id, url, title, wine_id, vintage_key, match_status, image_url) VALUES ($1, $2, 't', $3, $4, 'auto', $5)`, [m, url, wineId, vintage, image]);
    const lynch = ids.get('lynch-bages')!;
    await listing('https://shop.test/blanc', ids.get('lynch-bages-blanc')!, 'https://img.test/blanc.jpg', '2019'); // white wine: wrong colour
    await listing('https://shop.test/echo', ids.get('echo-lynch-bages')!, 'https://img.test/echo.jpg', '2018'); // red sibling
    await listing('https://shop.test/lb-dark', lynch, 'https://img.test/lb-lifestyle.jpg', '2016'); // same wine, not on white

    const white = await packshot('#ffffff');
    const dark = await packshot('#202020');
    const fetch = vi.fn(async (url: RequestInfo | URL) =>
      new Response(String(url).includes('lifestyle') ? dark : white, { headers: { 'content-type': 'image/jpeg' } }));

    // The same wine's photo isn't on white -> the red sibling's, never the white wine's.
    expect(await findWineImage(db, lynch, '2016', fetch as unknown as typeof globalThis.fetch)).toBe('https://img.test/echo.jpg');
    expect((await db.query('SELECT image_match FROM wines WHERE wine_id = $1', [lynch])).rows[0].image_match).toBe('producer');

    // Once the wine itself has a packshot, it wins.
    await listing('https://shop.test/lb-2016', lynch, 'https://img.test/lb-2016.jpg', '2016');
    expect(await findWineImage(db, lynch, '2016', fetch as unknown as typeof globalThis.fetch)).toBe('https://img.test/lb-2016.jpg');
    expect((await db.query('SELECT image_match FROM wines WHERE wine_id = $1', [lynch])).rows[0].image_match).toBe('vintage');
  });

  it("uses the wine's own shop photo when no listing is a packshot on white, but never a banner", async () => {
    const m = (await db.query(`INSERT INTO merchants (domain, name) VALUES ('shop2.test', 'Shop 2') ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name RETURNING merchant_id`)).rows[0].merchant_id;
    const wine = ids.get('opus-one')!;
    await db.query(`INSERT INTO listings (merchant_id, url, title, wine_id, vintage_key, match_status, image_url) VALUES ($1, 'https://shop2.test/banner', 't', $2, NULL, 'auto', 'https://img.test/banner.jpg')`, [m, wine]);
    const banner = await packshot('#202020', 900, 300);
    const dark = await packshot('#202020');
    let photos: Record<string, Buffer> = { banner };
    const fetch = vi.fn(async (url: RequestInfo | URL) => new Response((photos[String(url).split('/').pop()!.replace('.jpg', '')] ?? null) as BodyInit | null, { headers: { 'content-type': 'image/jpeg' } }));
    expect(await findWineImage(db, wine, null, fetch as unknown as typeof globalThis.fetch)).toBeNull();

    await db.query(`INSERT INTO listings (merchant_id, url, title, wine_id, vintage_key, match_status, image_url) VALUES ($1, 'https://shop2.test/dark', 't', $2, NULL, 'auto', 'https://img.test/dark.jpg')`, [m, wine]);
    photos = { banner, dark };
    expect(await findWineImage(db, wine, null, fetch as unknown as typeof globalThis.fetch)).toBe('https://img.test/dark.jpg');
  });

  it('serves wine photos through the API, fetched once, and only for URLs that are a wine photo', async () => {
    const wine = ids.get('caymus-ss')!;
    await db.query(`UPDATE wines SET image_url = 'http://img.test/caymus.png' WHERE wine_id = $1`, [wine]);
    const png = await sharp({ create: { width: 1200, height: 2400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const photoFetch = vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
    const a = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true }, photoFetch: photoFetch as unknown as typeof fetch });
    const get = (u: string) => request(a).get(`/api/photo?u=${encodeURIComponent(u)}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const r = await get('http://img.test/caymus.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['cache-control']).toContain('max-age');
    const meta = await sharp(r.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([600, 1200]);
    expect((await get('http://img.test/caymus.png')).status).toBe(200);
    expect(photoFetch).toHaveBeenCalledTimes(1);
    expect((await get('http://evil.test/anything.png')).status).toBe(404);
    expect(photoFetch).toHaveBeenCalledTimes(1);
  });
});
