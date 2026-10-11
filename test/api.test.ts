import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import type { LabelRead, LlmProvider } from '../src/llm/types.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const label = (r: Partial<LabelRead>): LabelRead => ({
  producer: '', name: '', vintage: '', region: '', country: '', grape: '', colour: '', bottleMl: null, rawText: '', confidence: 0.9, ...r,
});
const fetcher = new PoliteFetcher({ userAgent: 'WineTrackerBot/0.1', fetch: vi.fn(async () => new Response('', { status: 404 })) });
const app = (provider: LlmProvider) => createApp({ db, provider, fetcher, auth: { allowDev: true } });
const providerReading = (r: Partial<LabelRead>): LlmProvider => ({ name: 'fake', readLabel: vi.fn(async () => label(r)), searchPrices: vi.fn(async () => []) });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe('scan API', () => {
  it('auto-matches a clearly read label', async () => {
    const wineId = await createWine(db, { producer: 'Chateau Montelena', name: 'Chardonnay', region: 'Napa Valley', colour: 'white', source: 'lwin' });
    const res = await request(app(providerReading({ producer: 'Château Montelena', name: 'Chardonnay', vintage: '2021', region: 'Napa Valley' })))
      .post('/api/scans').attach('image', jpeg, { filename: 'l.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ outcome: 'auto', vintage: '2021', candidates: [{ wineId }] });
  });

  it('confirming a new wine creates it, and the next scan of that label matches it', async () => {
    const a = app(providerReading({ producer: 'Bedrock Wine Co', name: 'Evangelho Heritage', vintage: '2021' }));
    const scan = await request(a).post('/api/scans').attach('image', jpeg, { filename: 'l.jpg', contentType: 'image/jpeg' });
    expect(scan.body.outcome).toBe('new');
    const conf = await request(a).post(`/api/scans/${scan.body.scanId}/confirm`).send({ newWine: { producer: 'Bedrock Wine Co.', name: 'Evangelho Vineyard Heritage', region: 'Contra Costa County' } });
    expect(conf.status).toBe(200);
    const again = await request(a).post('/api/scans').attach('image', jpeg, { filename: 'l.jpg', contentType: 'image/jpeg' });
    expect(again.body.candidates[0].wineId).toBe(conf.body.wineId);
  });

  it('rejects non-images and reports a missing provider as 503', async () => {
    expect((await request(app(providerReading({}))).post('/api/scans').attach('image', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })).status).toBe(415);
    expect((await request(app(new NullProvider())).post('/api/scans').attach('image', jpeg, { filename: 'l.jpg', contentType: 'image/jpeg' })).status).toBe(503);
  });
});

describe('wine + price API', () => {
  it('searches, records a user price at tasting without moving the market price', async () => {
    const wineId = await createWine(db, { producer: 'Opus One', name: '', source: 'lwin' });
    const a = app(new NullProvider());
    const s = await request(a).get('/api/wines/search').query({ q: 'opus one 2019' });
    expect(s.body.results[0]).toMatchObject({ wineId });
    const rep = await request(a).post(`/api/wines/${wineId}/prices/report`).send({ price: 650, vintage: '2019', context: 'restaurant' });
    expect(rep.status).toBe(201);
    const p = await request(a).get(`/api/wines/${wineId}/prices`).query({ vintage: '2019' });
    expect(p.body.summary).toBeNull();
    expect((await request(a).post(`/api/wines/${wineId}/prices/report`).send({ price: -1 })).status).toBe(400);
  });

  it('refresh works without an LLM provider (rechecks known listings only)', async () => {
    const wineId = await createWine(db, { producer: 'Opus One', name: '', source: 'lwin' });
    const res = await request(app(new NullProvider())).post(`/api/wines/${wineId}/prices/refresh`).send({ vintage: '2019' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toMatchObject({ status: 'refreshed', searchError: 'no LLM provider configured' });
    expect((await request(app(new NullProvider())).get('/api/wines/999')).status).toBe(404);
  });
});
