import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createWine } from '../src/catalog/wines.js';
import { twinKey } from '../src/match/score.js';
import { mergeTwins } from '../src/catalog/twins.js';
import { ensureMerchant, ingestOffer } from '../src/prices/ingest.js';
import type { ExtractedOffer } from '../src/prices/extract.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const offer = (title: string, priceCents: number, extra: Partial<ExtractedOffer> = {}): ExtractedOffer => ({
  title, brand: '', sku: '', gtin: '', priceCents, currency: 'USD', inStock: true, attributes: {}, via: 'jsonld', ...extra,
});
const wines = async () => (await db.query('SELECT COUNT(*)::int AS n FROM wines')).rows[0].n as number;

describe('crawl ingest and copies of one wine', () => {
  it('files every vintage of a wine under one entry, even when the catalog already holds two copies', async () => {
    const m = await ensureMerchant(db, 'wally.test', 'Wally');
    // Two identical shop-created copies, as left behind by earlier crawls.
    await createWine(db, { producer: '', name: 'Bartolo Mascarello Barolo', display_name: 'Bartolo Mascarello Barolo', source: 'crawl' });
    await createWine(db, { producer: '', name: 'Bartolo Mascarello Barolo', display_name: 'Bartolo Mascarello Barolo', source: 'crawl' });
    const ids = new Set<number>();
    for (const year of [2009, 2016, 2018]) {
      const r = await ingestOffer(db, { merchantId: m, merchantName: 'Wally', url: `https://wally.test/bm${year}`, offer: offer(`${year} Bartolo Mascarello Barolo 750mL`, 30000) }, { createWines: true });
      expect(r.created).toBe(false);
      ids.add(r.wineId!);
    }
    expect(ids.size).toBe(1);
    expect(await wines()).toBe(2);
  });

  it('never treats generic titles as copies: different producers sell "Pinot Noir"', () => {
    expect(twinKey({ display_name: 'Pinot Noir' })).toBeNull();
    expect(twinKey({ display_name: 'Napa Valley Cabernet Sauvignon' })).toBeNull();
    expect(twinKey({ display_name: 'Chateau Palmer' })).toBe(twinKey({ display_name: 'chateau  PALMER' }));
    expect(twinKey({ display_name: 'Bartolo Mascarello Barolo' })).not.toBe(twinKey({ display_name: 'Bartolo Mascarello Langhe Nebbiolo' }));
    // Style words make different wines.
    const keys = ['Louis Roederer Brut', 'Louis Roederer Vintage Brut', 'Louis Roederer Brut Rose', 'Dom Perignon', 'Dom Perignon Rose'].map((n) => twinKey({ display_name: n }));
    expect(new Set(keys).size).toBe(5);
    expect(twinKey({ display_name: 'Chateau Palmer 750ml' })).toBe(twinKey({ display_name: 'Chateau Palmer' }));
  });
});

describe('mergeTwins', () => {
  const copy = (name: string, source: 'crawl' | 'lwin' | 'user' = 'crawl') => createWine(db, { producer: '', name, display_name: name, source });

  it('gathers every vintage of a wine, and its tastings, onto one entry', async () => {
    const m = await ensureMerchant(db, 'wally.test', 'Wally');
    const a = await copy('Chateau Palmer');
    const b = await copy('Chateau Palmer');
    const c = await copy('Chateau Palmer');
    const years: Record<number, string> = { [a]: '2009', [b]: '2016', [c]: '2018' };
    for (const id of [a, b, c]) {
      await db.query(
        `INSERT INTO price_observations (wine_id, vintage_key, bottle_ml, pack_size, price_cents, unit_750_cents, currency, in_stock, source_type, merchant_id, url, confidence, observed_at)
         VALUES ($1, $2, 750, 1, 40000, 40000, 'USD', true, 'crawl', $3, $4, 1, NOW())`,
        [id, years[id], m, `https://wally.test/palmer-${years[id]}`]
      );
    }
    const user = (await db.query(`INSERT INTO users (auth_sub, email) VALUES ('google:1', 'a@b.c') RETURNING user_id`)).rows[0].user_id;
    await db.query(`INSERT INTO tastings (user_id, wine_id, vintage_key) VALUES ($1, $2, '2018')`, [user, c]);

    expect((await mergeTwins(db, { dryRun: true })).length).toBe(2);
    expect(await wines()).toBe(3);
    const merges = await mergeTwins(db);
    expect(merges.map((x) => x.to)).toEqual([a, a]);
    expect(await wines()).toBe(1);
    const vintages = (await db.query(`SELECT vintage_key FROM wine_prices WHERE wine_id = $1 AND vintage_key <> '*' ORDER BY 1`, [a])).rows.map((r) => r.vintage_key);
    expect(vintages).toEqual(['2009', '2016', '2018']);
    expect((await db.query('SELECT wine_id FROM tastings')).rows).toEqual([{ wine_id: a }]);
  });

  it('keeps the catalog entry, and leaves generic names and two catalog entries alone', async () => {
    const lwin = await copy('Domaine Tempier Bandol', 'lwin');
    await copy('Domaine Tempier Bandol');
    await copy('Pinot Noir');
    await copy('Pinot Noir');
    await copy('Ridge Monte Bello', 'lwin');
    await copy('Ridge Monte Bello', 'user');
    await copy('Ridge Monte Bello');
    const merges = await mergeTwins(db);
    expect(merges).toEqual([expect.objectContaining({ to: lwin, name: 'Domaine Tempier Bandol' })]);
    expect(await wines()).toBe(6);
  });
});
