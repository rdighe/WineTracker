import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { createWine } from '../src/catalog/wines.js';
import { aggregateWines, removeOutliers, summarize } from '../src/prices/aggregate.js';
import type { ExtractedOffer } from '../src/prices/extract.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { ensureMerchant, ingestOffer } from '../src/prices/ingest.js';
import { refreshPrices } from '../src/prices/refresh.js';
import type { LlmProvider } from '../src/llm/types.js';
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

describe('summarize', () => {
  it('drops outliers before taking percentiles', () => {
    expect(removeOutliers([5000, 5200, 4900, 5100, 50000])).toEqual([5000, 5200, 4900, 5100]);
    expect(summarize([5000, 5200, 4900, 5100, 50000])).toMatchObject({ median: 5050, n: 4 });
    expect(summarize([7000])).toEqual({ median: 7000, p10: 7000, p90: 7000, n: 1 });
  });
});

describe('ingestOffer', () => {
  it('matches an existing wine, records a normalized observation, and is idempotent per day', async () => {
    const wineId = await createWine(db, { producer: 'Ridge Vineyards', name: 'Monte Bello', region: 'California', source: 'lwin' });
    const m = await ensureMerchant(db, 'www.shop.test', 'Shop');
    const args = { merchantId: m, merchantName: 'Shop', url: 'https://shop.test/mb18-mag', offer: offer('Ridge Monte Bello 2018 1.5L', 50000) };
    expect(await ingestOffer(db, args, { createWines: false })).toMatchObject({ wineId, status: 'priced', created: false });
    await ingestOffer(db, args, { createWines: false });
    const { rows } = await db.query('SELECT vintage_key, bottle_ml, unit_750_cents FROM price_observations');
    expect(rows).toEqual([{ vintage_key: '2018', bottle_ml: 1500, unit_750_cents: 25000 }]);
  });

  it('creates a catalog wine from an unmatched listing when allowed, using brand as producer', async () => {
    const m = await ensureMerchant(db, 'shop.test');
    const r = await ingestOffer(db, {
      merchantId: m, merchantName: 'shop.test', url: 'https://shop.test/p1',
      offer: offer('Bedrock Wine Co. Old Vine Zinfandel 2022', 2800, { brand: 'Bedrock Wine Co.', attributes: { country: 'USA', region: 'Sonoma County', varietal: 'Zinfandel' } }),
    }, { createWines: true });
    expect(r).toMatchObject({ status: 'priced', created: true });
    const { rows } = await db.query('SELECT producer, name, region, grape, source FROM wines');
    expect(rows[0]).toEqual({ producer: 'Bedrock Wine Co.', name: 'Old Vine Zinfandel', region: 'Sonoma County', grape: 'Zinfandel', source: 'crawl' });
    // A second shop selling the same wine attaches to it instead of creating another.
    const r2 = await ingestOffer(db, { merchantId: m, merchantName: 'shop.test', url: 'https://shop.test/p2', offer: offer('Bedrock Old Vine Zinfandel 2022 750ml', 2999) }, { createWines: true });
    expect(r2).toMatchObject({ wineId: r.wineId, created: false });
  });

  it('uses the vendor as producer when the title is only a grape', async () => {
    const m = await ensureMerchant(db, 'shop.test', 'Shop');
    const a = await ingestOffer(db, { merchantId: m, merchantName: 'Shop', url: 'https://shop.test/a', offer: offer('Pinot Noir 2022', 4000, { brand: 'Rhys Vineyards' }) }, { createWines: true });
    const b = await ingestOffer(db, { merchantId: m, merchantName: 'Shop', url: 'https://shop.test/b', offer: offer('Pinot Noir 2022', 3000, { brand: 'Sunu' }) }, { createWines: true });
    const c = await ingestOffer(db, { merchantId: m, merchantName: 'Shop', url: 'https://shop.test/c', offer: offer('Pinot Noir 2021', 4200, { brand: 'Rhys Vineyards' }) }, { createWines: true });
    expect(a.wineId).not.toBe(b.wineId);
    expect(c.wineId).toBe(a.wineId);
    const { rows } = await db.query('SELECT producer, display_name FROM wines WHERE wine_id = $1', [a.wineId]);
    expect(rows[0]).toEqual({ producer: 'Rhys Vineyards', display_name: 'Rhys Vineyards Pinot Noir' });
  });

  it('skips non-wine and non-USD offers', async () => {
    const m = await ensureMerchant(db, 'shop.test');
    expect((await ingestOffer(db, { merchantId: m, merchantName: 's', url: 'https://shop.test/g', offer: offer('Riedel Wine Glasses Set of 2', 5000) }, { createWines: true })).status).toBe('not_wine');
    expect((await ingestOffer(db, { merchantId: m, merchantName: 's', url: 'https://shop.test/e', offer: offer('Some Wine 2019', 5000, { currency: 'EUR' }) }, { createWines: true })).status).toBe('skipped_currency');
  });
});

describe('aggregateWines', () => {
  it('summarizes per vintage and overall, one vote per listing', async () => {
    const wineId = await createWine(db, { producer: 'Opus One', name: '', source: 'lwin' });
    const m = await ensureMerchant(db, 'shop.test');
    const day = (d: number) => new Date(Date.now() - d * 86400000);
    const add = (url: string, title: string, cents: number, d: number) =>
      ingestOffer(db, { merchantId: m, merchantName: 's', url, offer: offer(title, cents) }, { createWines: false, observedAt: day(d) });
    await add('https://shop.test/a', 'Opus One 2019', 40000, 10);
    await add('https://shop.test/a', 'Opus One 2019', 42000, 2);      // newer price at the same listing wins
    await add('https://shop.test/b', 'Opus One 2019', 44000, 3);
    await add('https://shop.test/c', 'Opus One 2018', 38000, 1);
    await aggregateWines(db, [wineId]);
    const { rows } = await db.query('SELECT vintage_key, median_cents, n_observations, window_days FROM wine_prices ORDER BY vintage_key');
    expect(rows).toEqual([
      { vintage_key: '*', median_cents: 42000, n_observations: 3, window_days: 30 },
      { vintage_key: '2018', median_cents: 38000, n_observations: 1, window_days: 30 },
      { vintage_key: '2019', median_cents: 43000, n_observations: 2, window_days: 30 },
    ]);
    const daily = await db.query(`SELECT COUNT(*)::int AS n FROM wine_price_daily WHERE vintage_key = '2019'`);
    expect(daily.rows[0].n).toBe(3);
  });

  it('uses out-of-stock prices only for vintages with no in-stock offer, and says so', async () => {
    const wineId = await createWine(db, { producer: 'Opus One', name: '', source: 'lwin' });
    const m = await ensureMerchant(db, 'shop.test');
    const day = (d: number) => new Date(Date.now() - d * 86400000);
    const add = (url: string, title: string, cents: number, d: number, inStock: boolean) =>
      ingestOffer(db, { merchantId: m, merchantName: 's', url, offer: offer(title, cents, { inStock }) }, { createWines: false, observedAt: day(d) });
    await add('https://shop.test/a', 'Opus One 2019', 40000, 2, true);
    await add('https://shop.test/b', 'Opus One 2019', 90000, 1, false);   // ignored: 2019 is in stock elsewhere
    await add('https://shop.test/c', 'Opus One 2013', 50000, 3, false);   // the only 2013 offer
    await add('https://shop.test/d', 'Opus One 2012', 47000, 200, true);  // in stock last year beats out of stock now
    await add('https://shop.test/e', 'Opus One 2012', 80000, 5, false);
    await aggregateWines(db, [wineId]);
    const { rows } = await db.query('SELECT vintage_key, median_cents, window_days, out_of_stock_only FROM wine_prices ORDER BY vintage_key');
    expect(rows).toEqual([
      { vintage_key: '*', median_cents: 40000, window_days: 30, out_of_stock_only: false },
      { vintage_key: '2012', median_cents: 47000, window_days: 365, out_of_stock_only: false },
      { vintage_key: '2013', median_cents: 50000, window_days: 30, out_of_stock_only: true },
      { vintage_key: '2019', median_cents: 40000, window_days: 30, out_of_stock_only: false },
    ]);
  });

  it('keeps vintages only offered in the past year next to ones offered this month', async () => {
    const wineId = await createWine(db, { producer: 'Opus One', name: '', source: 'lwin' });
    const m = await ensureMerchant(db, 'shop.test');
    const day = (d: number) => new Date(Date.now() - d * 86400000);
    const add = (url: string, title: string, cents: number, d: number) =>
      ingestOffer(db, { merchantId: m, merchantName: 's', url, offer: offer(title, cents) }, { createWines: false, observedAt: day(d) });
    await add('https://shop.test/a', 'Opus One 2021', 45000, 2);
    await add('https://shop.test/b', 'Opus One 2015', 60000, 90);
    await add('https://shop.test/c', 'Opus One 2015', 62000, 120);
    await aggregateWines(db, [wineId]);
    const { rows } = await db.query('SELECT vintage_key, median_cents, n_observations, window_days FROM wine_prices ORDER BY vintage_key');
    expect(rows).toEqual([
      { vintage_key: '*', median_cents: 45000, n_observations: 1, window_days: 30 },
      { vintage_key: '2015', median_cents: 61000, n_observations: 2, window_days: 365 },
      { vintage_key: '2021', median_cents: 45000, n_observations: 1, window_days: 30 },
    ]);
  });
});

describe('refreshPrices', () => {
  const html = (title: string, price: string) =>
    `<script type="application/ld+json">{"@type":"Product","name":"${title}","offers":{"price":"${price}","priceCurrency":"USD"}}</script>`;

  function site(pages: Record<string, string>) {
    return vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(url instanceof Request ? url.url : String(url));
      if (u.pathname === '/robots.txt') return new Response(u.host === 'blocked.test' ? 'User-agent: *\nDisallow: /' : '');
      const body = pages[u.toString()];
      return body ? new Response(body) : new Response('', { status: 404 });
    });
  }

  it('rechecks known listings, verifies web hits, keeps clear unverified ones, and throttles', async () => {
    const wineId = await createWine(db, { producer: 'Caymus Vineyards', name: 'Special Selection Cabernet Sauvignon', source: 'lwin' });
    const m = await ensureMerchant(db, 'known.test');
    await ingestOffer(db, { merchantId: m, merchantName: 'k', url: 'https://known.test/ss19', offer: offer('Caymus Special Selection Cabernet Sauvignon 2019', 17000) }, { createWines: false });

    const fetch = site({
      'https://known.test/ss19': html('Caymus Special Selection Cabernet Sauvignon 2019', '175.00'),
      'https://new.test/caymus-ss-2019': html('Caymus Special Selection Cab Sauv 2019', '180.00'),
    });
    const fetcher = new PoliteFetcher({ userAgent: 'WineTrackerBot/0.1', minDelayMs: 0, fetch, sleep: async () => {} });
    const provider: LlmProvider = {
      name: 'fake',
      readLabel: vi.fn(),
      searchPrices: vi.fn(async () => [
        { merchant: 'New', url: 'https://new.test/caymus-ss-2019', priceCents: 18000, currency: 'USD', vintage: '2019', bottleMl: null, packSize: 1, inStock: true, title: 'Caymus Special Selection 2019' },
        { merchant: 'Blocked', url: 'https://blocked.test/x', priceCents: 16500, currency: 'USD', vintage: '2019', bottleMl: null, packSize: 1, inStock: true, title: 'Caymus Special Selection Cabernet Sauvignon 2019' },
        { merchant: 'Other vintage', url: 'https://other.test/x', priceCents: 9000, currency: 'USD', vintage: '2017', bottleMl: null, packSize: 1, inStock: true, title: 'Caymus Special Selection 2017' },
        { merchant: 'VV', url: 'https://www.vivino.com/x', priceCents: 1000, currency: 'USD', vintage: '2019', bottleMl: null, packSize: 1, inStock: true, title: 'Caymus Special Selection 2019' },
      ]),
    };

    const r = await refreshPrices(db, fetcher, provider, wineId, '2019');
    expect(r).toMatchObject({ status: 'refreshed', rechecked: 1, webHits: 4, verified: 1, unverifiedKept: 1 });
    const { rows } = await db.query(`SELECT median_cents, n_observations FROM wine_prices WHERE vintage_key = '2019'`);
    expect(rows[0]).toEqual({ median_cents: 17500, n_observations: 3 });
    expect((await refreshPrices(db, fetcher, provider, wineId, '2019')).status).toBe('throttled');
  });

  it('with web search off, only rechecks known listings and never calls the LLM', async () => {
    const wineId = await createWine(db, { producer: 'Ridge Vineyards', name: 'Monte Bello', source: 'lwin' });
    const m = await ensureMerchant(db, 'known.test');
    await ingestOffer(db, { merchantId: m, merchantName: 'k', url: 'https://known.test/mb19', offer: offer('Ridge Monte Bello 2019', 25000) }, { createWines: false });
    const fetch = site({ 'https://known.test/mb19': html('Ridge Monte Bello 2019', '260.00') });
    const fetcher = new PoliteFetcher({ userAgent: 'WineTrackerBot/0.1', minDelayMs: 0, fetch, sleep: async () => {} });
    const provider: LlmProvider = { name: 'fake', readLabel: vi.fn(), searchPrices: vi.fn(async () => []) };

    const r = await refreshPrices(db, fetcher, provider, wineId, '2019', { webSearch: false });
    expect(r).toMatchObject({ status: 'refreshed', rechecked: 1, webHits: 0, searchError: null });
    expect(provider.searchPrices).not.toHaveBeenCalled();
  });
});
