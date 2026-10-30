import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { detectPart, starsFromScore } from '../src/imports/cellartracker.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const INVENTORY = [
  'iInventory,Barcode,Location,Bin,Size,Currency,Price,StoreName,PurchaseDate,iWine,Type,Color,Category,Vintage,Wine,Producer,Varietal,Country,Region,SubRegion,Appellation',
  '1,0101,Home,A3,750ml,USD,45.00,K&L,9/14/2024,111,Red,Red,Dry,2019,Ridge Geyserville,Ridge,Zinfandel Blend,USA,California,Sonoma County,Alexander Valley',
  '2,0102,Home,A3,750ml,USD,45.00,K&L,9/14/2024,111,Red,Red,Dry,2019,Ridge Geyserville,Ridge,Zinfandel Blend,USA,California,Sonoma County,Alexander Valley',
  '3,0103,Locker,B1,1.5L,USD,120.00,K&L,9/14/2024,222,Red,Red,Dry,2016,Château Musar Rouge,Château Musar,Red Blend,Lebanon,Bekaa Valley,,',
].join('\r\n');
const NOTES = [
  'iNote,iWine,Type,Color,Category,Vintage,Wine,Producer,Country,Region,TastingDate,Rating,TastingNotes',
  '9,111,Red,Red,Dry,2018,Ridge Geyserville,Ridge,USA,California,3/2/2025,92,"Brambly, peppery; great with ribs."',
].join('\r\n');
const CONSUMED = [
  'iConsumed,iWine,Type,Consumed,Size,Vintage,Wine,Producer,Country,ConsumptionNote',
  '50,111,Red,3/2/2025,750ml,2018,Ridge Geyserville,Ridge,USA,',
  '51,333,White,4/1/2025,750ml,2022,Domaine Vacheron Sancerre,Domaine Vacheron,France,Picnic',
].join('\r\n');
const TAGS = ['ListName,iWine,Vintage,Wine,Producer,Country', 'Wishlist,444,2015,Vietti Barolo Castiglione,Vietti,Italy', 'Gifts,555,2020,Other Wine,Other,France'].join('\r\n');

const fakeCt = (tables: Record<string, string>) => vi.fn(async (url: string | URL | Request) => {
  const u = new URL(String(url));
  if (u.searchParams.get('Password') !== 'right') return new Response('<html><body>Please log in to CellarTracker</body></html>', { status: 200 });
  const text = tables[u.searchParams.get('Table') ?? ''] ?? '';
  return new Response(new TextEncoder().encode(text), { status: 200 });
});

describe('CellarTracker import', () => {
  it('maps scores to stars and tells tables apart by their columns', () => {
    expect([starsFromScore('96'), starsFromScore('92'), starsFromScore('88'), starsFromScore('80'), starsFromScore('70'), starsFromScore('4.3'), starsFromScore('')]).toEqual([5, 4.2, 3.8, 3, 1, 4.3, null]);
    expect([detectPart(INVENTORY), detectPart(NOTES), detectPart(CONSUMED), detectPart(TAGS), detectPart('a,b\n1,2')]).toEqual(['collection', 'notes', 'history', 'wishlist', null]);
  });

  it('imports with a handle and password it never keeps: bottles with location and bin, notes as stars, history, wishlist; again adds nothing', async () => {
    await createWine(db, { producer: 'Ridge', name: 'Geyserville', region: 'California', country: 'USA', colour: 'red', source: 'lwin' });
    const ctFetch = fakeCt({ Inventory: INVENTORY, Notes: NOTES, Consumed: CONSUMED, Tag: TAGS });
    const app = createApp({ db, provider: new NullProvider(), ctFetch: ctFetch as unknown as typeof fetch, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const as = { Authorization: 'Dev r' };
    const bad = await request(app).post('/api/import/cellartracker').set(as).send({ handle: 'rohan', password: 'wrong', parts: ['collection'] });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).not.toContain('wrong');

    const parts = ['collection', 'notes', 'history', 'wishlist'];
    const r = await request(app).post('/api/import/cellartracker').set(as).send({ handle: 'rohan', password: 'right', parts });
    expect(r.status).toBe(200);
    expect(r.body.parts).toMatchObject({
      collection: { rows: 3, imported: 2, bottles: 3 }, notes: { imported: 1 }, history: { rows: 2, imported: 1 }, wishlist: { rows: 1, imported: 1 },
    });
    expect(String(ctFetch.mock.calls[1]![0])).toContain('Table=Inventory');
    const t = (await request(app).get('/api/tastings').set(as)).body.tastings;
    const ridge = t.find((x: { kind: string; bottles: number }) => x.kind === 'cellar' && x.bottles === 2);
    expect(ridge).toMatchObject({ vintage_key: '2019', location: 'Home · A3', price_paid_cents: 4500, tasted_on: '2024-09-14' });
    expect(t.find((x: { kind: string; bottle_ml: number }) => x.kind === 'cellar' && x.bottle_ml === 1500)).toMatchObject({ location: 'Locker · B1', bottles: 1 });
    expect(t.find((x: { rating: number | null }) => x.rating !== null)).toMatchObject({ rating: 4.2, notes: 'Brambly, peppery; great with ribs.', tasted_on: '2025-03-02' });
    // The Ridge drunk the day it was noted isn't logged twice; the Sancerre is.
    expect(t.filter((x: { kind: string }) => x.kind === 'tasted')).toHaveLength(2);
    expect((await request(app).get('/api/saved').set(as)).body.saved).toHaveLength(1);
    // Nothing about the password is kept anywhere.
    const dump = await db.query(`SELECT string_agg(t::text, ' ') AS s FROM (SELECT * FROM tastings) t`);
    expect(dump.rows[0].s).not.toContain('right');

    const again = await request(app).post('/api/import/cellartracker').set(as).send({ handle: 'rohan', password: 'right', parts });
    expect(again.body.parts.collection).toMatchObject({ imported: 0, alreadyImported: 2 });
    expect(again.body.parts.notes).toMatchObject({ imported: 0, alreadyImported: 1 });
  });

  it('imports CellarTracker files uploaded instead, and refuses other files', async () => {
    const app = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const as = { Authorization: 'Dev r' };
    const r = await request(app).post('/api/import/cellartracker').set(as).send({ files: [INVENTORY] });
    expect(r.body.parts.collection).toMatchObject({ imported: 2, bottles: 3 });
    expect((await request(app).post('/api/import/cellartracker').set(as).send({ files: ['Winery,Wine name\nx,y'] })).status).toBe(400);
  });
});
