import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createInfoResearcher } from '../src/catalog/info.js';
import { createWine } from '../src/catalog/wines.js';
import { GeminiProvider } from '../src/llm/gemini.js';
import { sanitizeLabels, sanitizeWineInfo } from '../src/llm/sanitize.js';
import type { LabelRead, LlmProvider, WineInfo } from '../src/llm/types.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const fetcher = new PoliteFetcher({ userAgent: 'WineTrackerBot/0.1', fetch: vi.fn(async () => new Response('', { status: 404 })) });
const label = (r: Partial<LabelRead>): LabelRead => ({
  producer: '', name: '', vintage: '', region: '', country: '', grape: '', colour: '', bottleMl: null, rawText: '', confidence: 0.9, ...r,
});
const rawInfo = {
  summary: 'The grand vin of a Sauternes first growth.',
  tasting_notes: { nose: 'Apricot, honey, saffron', palate: 'Rich, balanced by acidity' },
  descriptors: ['Apricot', 'honey', 'apricot', 'saffron'],
  food_pairings: ['blue cheese', 'foie gras'],
  producer: { history: 'Founded in the 17th century.', founded: '1580', website: 'javascript:alert(1)' },
  specs: { grapes: 'Semillon 90%, Sauvignon Blanc 10%', abv: '14%' },
  wine: { colour: 'White', wine_type: 'dessert', country: 'France', region: 'Bordeaux', sub_region: 'Sauternes', grape: 'Semillon' },
  sources: [{ title: 'Estate', url: 'https://suduiraut.example/' }, { url: 'ftp://nope' }, 'junk'],
  spec_sheets: [{ title: '2019 technical sheet', url: 'https://suduiraut.example/2019.pdf' }, { url: 'nope' }],
  tasting_sources: [
    { source: 'Château Suduiraut', url: 'https://suduiraut.example/2019.pdf', kind: 'Producer', notes: 'Apricot, honey and saffron.' },
    { source: 'A critic', kind: 'sommelier', notes: 'Candied orange and honey.' },
    { source: '', notes: 'no source' },
  ],
  consensus: 'All agree on apricot and honey; the critic finds more citrus.',
};
const info = sanitizeWineInfo(rawInfo, true)!;

describe('sanitizing model output', () => {
  it('cleans researched info and rejects empty replies', () => {
    expect(info.descriptors).toEqual(['apricot', 'honey', 'saffron']);
    expect(info.producer.website).toBe('');
    expect(info.wine).toMatchObject({ colour: 'white', wineType: 'dessert', subRegion: 'Sauternes' });
    expect(info.sources).toEqual([{ title: 'Estate', url: 'https://suduiraut.example/' }]);
    expect(info.tastingNotes.finish).toBe('');
    expect(sanitizeWineInfo({ summary: '', descriptors: ['x'] }, true)).toBeNull();
    expect(sanitizeWineInfo(rawInfo, false)!.sources).toEqual([]);
    expect(info.specSheets).toEqual([{ title: '2019 technical sheet', url: 'https://suduiraut.example/2019.pdf' }]);
    expect(info.tastingSources).toEqual([
      { source: 'Château Suduiraut', url: 'https://suduiraut.example/2019.pdf', kind: 'producer', notes: 'Apricot, honey and saffron.' },
      { source: 'A critic', url: '', kind: 'other', notes: 'Candied orange and honey.' },
    ]);
    expect(info.consensus).toMatch(/agree/);
    // Without a web search there are no sources to quote.
    expect(sanitizeWineInfo(rawInfo, false)).toMatchObject({ specSheets: [], tastingSources: [], consensus: '' });
  });

  it('reads lineups as {"bottles": [...]} or a bare array, dropping unreadable entries', () => {
    expect(sanitizeLabels({ bottles: [{ producer: 'Ridge', confidence: 0.9 }, { producer: '', name: '', raw_text: '' }] })).toHaveLength(1);
    expect(sanitizeLabels([{ producer: 'A' }, { producer: 'B' }])).toHaveLength(2);
    expect(sanitizeLabels({ nope: true })).toBeNull();
    expect(sanitizeLabels({ bottles: Array.from({ length: 20 }, (_, i) => ({ producer: `P${i}` })) })).toHaveLength(12);
  });
});

describe('Gemini research', () => {
  const reply = (text: string, status = 200) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });

  it('searches the web first, and answers from its own knowledge when the key cannot', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply('', 400)).mockResolvedValue(reply(JSON.stringify(rawInfo)));
    const r = await new GeminiProvider({ apiKey: 'k', fetch }).researchWine({ displayName: 'Chateau Suduiraut', producer: '', region: '', country: '', grape: '', colour: '' });
    expect(JSON.parse(fetch.mock.calls[0]![1].body).tools).toEqual([{ google_search: {} }]);
    expect(JSON.parse(fetch.mock.calls[1]![1].body).tools).toBeUndefined();
    expect(r.grounded).toBe(false);
    expect(r.summary).toMatch(/Sauternes/);
  });
});

describe('wine info API', () => {
  const user = { Authorization: 'Dev rohan' };

  function setup(researchWine?: LlmProvider['researchWine']) {
    const provider: LlmProvider = { name: 'fake', readLabel: vi.fn(), searchPrices: vi.fn(async () => []), ...(researchWine ? { researchWine } : {}) };
    const researcher = createInfoResearcher(db, provider, () => {});
    return { researcher, app: createApp({ db, provider, fetcher, auth: { allowDev: true }, infoResearcher: researcher }) };
  }

  it('researches once when a signed-in user asks, then serves it and fills blanks on the wine', async () => {
    let finish!: () => void;
    const researched = new Promise<void>((r) => (finish = r));
    const researchWine = vi.fn(async (): Promise<WineInfo> => (await researched, info));
    const { app, researcher } = setup(researchWine);
    const wineId = await createWine(db, { producer: 'Chateau Suduiraut', name: '', region: 'Bordeaux (Graves)', source: 'crawl' });

    expect((await request(app).get(`/api/wines/${wineId}/info`)).body).toEqual({ status: 'none', info: null, refreshing: false });
    expect((await request(app).get(`/api/wines/${wineId}/info`).set(user)).body.status).toBe('pending');
    finish();
    await researcher.drained();
    const res = await request(app).get(`/api/wines/${wineId}/info`).set(user);
    expect(res.body.status).toBe('ready');
    expect(res.body.info.specs.grapes).toMatch(/Semillon/);
    expect(researchWine).toHaveBeenCalledTimes(1);

    const { rows } = await db.query('SELECT colour, wine_type, region, sub_region, grape, country FROM wines WHERE wine_id = $1', [wineId]);
    // Blanks filled; the region already there is kept.
    expect(rows[0]).toEqual({ colour: 'white', wine_type: 'dessert', region: 'Bordeaux (Graves)', sub_region: '', grape: 'Semillon', country: 'France' });
  });

  it('redoes research from before spec sheets when the wine is opened, showing the old notes meanwhile', async () => {
    let finish!: () => void;
    const researched = new Promise<void>((r) => (finish = r));
    const researchWine = vi.fn(async (): Promise<WineInfo> => (await researched, info));
    const { app, researcher } = setup(researchWine);
    const wineId = await createWine(db, { producer: 'Chateau Suduiraut', name: '', source: 'crawl' });
    // Research in the first format: no version, no spec sheets.
    await db.query(`INSERT INTO wine_info (wine_id, status, info) VALUES ($1, 'ready', $2)`, [wineId, JSON.stringify({ ...info, specSheets: undefined, tastingSources: undefined, version: undefined })]);
    const during = (await request(app).get(`/api/wines/${wineId}/info`).set(user)).body;
    expect(during).toMatchObject({ status: 'pending', refreshing: true, info: { summary: info.summary } });
    finish();
    await researcher.drained();
    const after = (await request(app).get(`/api/wines/${wineId}/info`).set(user)).body;
    expect(after).toMatchObject({ status: 'ready', refreshing: false, info: { version: 2, specSheets: [{ url: 'https://suduiraut.example/2019.pdf' }] } });
    // Current research isn't redone.
    await request(app).get(`/api/wines/${wineId}/info`).set(user);
    await researcher.drained();
    expect(researchWine).toHaveBeenCalledTimes(1);
  });

  it('starts research when a wine is added, and does not hammer a failing provider', async () => {
    const researchWine = vi.fn(async (): Promise<WineInfo> => {
      throw new Error('model overloaded');
    });
    const { app, researcher } = setup(researchWine);
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    expect((await request(app).post('/api/tastings').set(user).send({ wineId, kind: 'cellar', bottles: 2 })).status).toBe(201);
    await researcher.drained();
    expect(researchWine).toHaveBeenCalledTimes(1);
    expect((await request(app).get(`/api/wines/${wineId}/info`).set(user)).body.status).toBe('failed');
    await researcher.drained();
    expect(researchWine).toHaveBeenCalledTimes(1);
  });

  it('researches with the text of a scanned label, so wines that share a name are told apart', async () => {
    const researchWine = vi.fn(async (): Promise<WineInfo> => info);
    const { app, researcher } = setup(researchWine);
    const wineId = await createWine(db, { producer: '', name: 'Les Perrières', source: 'user' });
    await db.query(
      `INSERT INTO scans (image_sha256, extracted, candidates, outcome, chosen_wine_id, provider, confirmed_at)
       VALUES ('x', $1, '[]', 'new', $2, 'fake', NOW())`,
      [JSON.stringify(label({ producer: 'Les Perrières', rawText: 'Les Perrières SOCIÉTÉ CIVILE DU CHÂTEAU LAFLEUR 2023' })), wineId]
    );
    await request(app).get(`/api/wines/${wineId}/info`).set(user);
    await researcher.drained();
    expect(researchWine).toHaveBeenCalledWith(expect.objectContaining({ labelText: expect.stringContaining('CHÂTEAU LAFLEUR') }));
  });

  it('says so when the server cannot research', async () => {
    const { app } = setup();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    expect((await request(app).get(`/api/wines/${wineId}/info`).set(user)).body).toEqual({ status: 'unavailable', info: null, refreshing: false });
  });
});

describe('lineup scans', () => {
  it('reads every bottle in one photo and matches each, one scan per bottle', async () => {
    const known = await createWine(db, { producer: 'Chateau Montelena', name: 'Chardonnay', region: 'Napa Valley', colour: 'white', source: 'lwin' });
    const provider: LlmProvider = {
      name: 'fake', readLabel: vi.fn(), searchPrices: vi.fn(async () => []),
      readLabels: vi.fn(async () => [
        label({ producer: 'Château Montelena', name: 'Chardonnay', vintage: '2021', region: 'Napa Valley' }),
        label({ producer: 'Domaine Inconnu', name: 'Cuvée Mystère', vintage: '2019' }),
      ]),
    };
    const app = createApp({ db, provider, fetcher, auth: { allowDev: true } });
    // A real photo is far over the 100 KB limit other routes have.
    const imageBase64 = Buffer.alloc(300_000, 1).toString('base64');
    const res = await request(app).post('/api/scans/lineup').set({ Authorization: 'Dev rohan' }).send({ imageBase64, mimeType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.scans).toEqual([
      expect.objectContaining({ outcome: 'auto', vintage: '2021', candidates: [expect.objectContaining({ wineId: known })] }),
      expect.objectContaining({ outcome: 'new', vintage: '2019' }),
    ]);
    const conf = await request(app).post(`/api/scans/${res.body.scans[1].scanId}/confirm`).send({ newWine: { producer: 'Domaine Inconnu', name: 'Cuvée Mystère' } });
    expect(conf.status).toBe(200);
    const owners = await db.query('SELECT DISTINCT user_id FROM scans');
    expect(owners.rows).toHaveLength(1);
    expect(owners.rows[0].user_id).not.toBeNull();
  });

  it('is unavailable when the provider cannot read several labels', async () => {
    const provider: LlmProvider = { name: 'fake', readLabel: vi.fn(), searchPrices: vi.fn(async () => []) };
    const res = await request(createApp({ db, provider, fetcher, auth: { allowDev: true } })).post('/api/scans/lineup').send({ imageBase64: Buffer.from('x').toString('base64'), mimeType: 'image/jpeg' });
    expect(res.status).toBe(503);
  });
});
