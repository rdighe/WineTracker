import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { sanitizeNoteFlavors } from '../src/llm/sanitize.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { concordance, evaluateUser, spearman } from '../src/recs/evaluate.js';
import { wineFeatures } from '../src/recs/features.js';
import { loadProfile, loadRatedTastings, type RatedTasting } from '../src/recs/recommend.js';
import { createNoteFlavorReader, noteHash, ownFlavorWeights } from '../src/tastings/noteFlavors.js';
import { readFileSync } from 'node:fs';
import { FLAVOR_KEYS } from '../src/recs/flavors.js';
import { closeDb, resetDb, testDb } from './helpers.js';

function reply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe('reading flavors from notes', () => {
  it('keeps known families with intensities 1-3 and drops the rest', () => {
    expect(sanitizeNoteFlavors({ flavors: { oak: 2, spice: '3', black_fruit: 7, fresh: 0, nonsense: 2 } })).toEqual({ oak: 2, spice: 3, black_fruit: 3 });
    expect(sanitizeNoteFlavors({ earthy: 1.4 })).toEqual({ earthy: 1 });
    expect(sanitizeNoteFlavors({ flavors: {} })).toEqual({});
    expect(sanitizeNoteFlavors({ flavors: 'oak' })).toBeNull();
    expect(sanitizeNoteFlavors('oak')).toBeNull();
  });

  it('reads the same families on the phone', () => {
    const swift = readFileSync(new URL('../mobile/modules/note-flavors/ios/NoteFlavorsModule.swift', import.meta.url), 'utf8');
    const cases = [...swift.matchAll(/^\s*case ([a-z_, ]+)$/gm)].flatMap((m) => m[1]!.split(',').map((c) => c.trim()));
    expect(cases.sort()).toEqual([...FLAVOR_KEYS].sort());
    const app = readFileSync(new URL('../mobile/src/lib/noteFlavors.ts', import.meta.url), 'utf8');
    for (const k of FLAVOR_KEYS) expect(app).toContain(`'${k}'`);
  });

  it('weights a hint, a clear note and a dominant one', () => {
    expect(ownFlavorWeights({ oak: 1, spice: 2, black_fruit: 3 })).toEqual({ oak: 1, spice: 1.5, black_fruit: 2 });
  });

  it('identifies the text by its words, not its spacing or case', () => {
    expect(noteHash('Peppery,  smoky', ['Bold'])).toBe(noteHash('peppery, smoky', ['bold']));
    expect(noteHash('Peppery', [])).not.toBe(noteHash('Peppery', ['bold']));
    expect(noteHash('  ', [])).toBe('');
  });

  it('asks an OpenRouter free model with the note and the families', async () => {
    const fetch = vi.fn().mockResolvedValue(reply('{"flavors":{"oak":3,"red_fruit":2}}'));
    const p = new OpenRouterProvider({ apiKey: 'k', fetch });
    expect(await p.readNoteFlavors('Campfire and cherries.')).toEqual({ oak: 3, red_fruit: 2 });
    const prompt = JSON.parse(fetch.mock.calls[0]![1].body).messages[0].content[0].text as string;
    expect(prompt).toContain('Campfire and cherries.');
    expect(prompt).toContain('- black_fruit: black fruit');
    expect(prompt).toMatch(/absent or wished for/);
  });
});

describe('note flavors in tastings and the profile', () => {
  let db: pg.Pool;
  beforeEach(async () => {
    db = await testDb();
    await resetDb(db);
  });
  afterAll(closeDb);

  const fetcher = () => new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() });
  const as = (r: request.Test) => r.set('Authorization', 'Dev rohan');

  it('keeps flavors read on the phone, and reads the rest with OpenRouter in the background', async () => {
    const readNoteFlavors = vi.fn().mockResolvedValue({ oak: 1 });
    const reader = createNoteFlavorReader(db, Object.assign(new NullProvider(), { readNoteFlavors }), () => {});
    const app = createApp({ db, provider: new NullProvider(), fetcher: fetcher(), auth: { allowDev: true }, noteReader: reader });
    const wineId = await createWine(db, { producer: 'Clape', name: 'Cornas', grape: 'Syrah', colour: 'red', source: 'lwin' });

    // Read on the phone: stored as is, nothing asked of the server.
    const a = await as(request(app).post('/api/tastings')).send({ wineId, rating: 4, notes: 'Peppery, not oaky at all', noteFlavors: { spice: 3, oak: 1 } });
    expect(a.status).toBe(201);
    // A bad family name is refused, not stored.
    expect((await as(request(app).post('/api/tastings')).send({ wineId, rating: 4, notes: 'x', noteFlavors: { umami: 2 } })).status).toBe(400);

    // Not read on the phone: the server reads it.
    const b = await as(request(app).post('/api/tastings')).send({ wineId, rating: 3, notes: 'Toasty and vanilla', tags: ['Bold'] });
    await reader.drained();
    expect(readNoteFlavors).toHaveBeenCalledWith('Tags: bold\nToasty and vanilla');
    const { rows } = await db.query('SELECT tasting_id, note_flavors, note_flavors_source FROM tastings ORDER BY tasting_id');
    expect(rows).toEqual([
      { tasting_id: a.body.tastingId, note_flavors: { spice: 3, oak: 1 }, note_flavors_source: 'apple' },
      { tasting_id: b.body.tastingId, note_flavors: { oak: 1 }, note_flavors_source: 'openrouter' },
    ]);

    // Editing the words makes the old reading stale until the new one is in.
    await as(request(app).patch(`/api/tastings/${b.body.tastingId}`)).send({ notes: 'Actually more cherry than oak' });
    readNoteFlavors.mockResolvedValueOnce({ red_fruit: 2 });
    await reader.drained();
    expect(readNoteFlavors).toHaveBeenLastCalledWith('Tags: bold\nActually more cherry than oak');
    const { rows: [edited] } = await db.query('SELECT note_flavors FROM tastings WHERE tasting_id = $1', [b.body.tastingId]);
    expect(edited.note_flavors).toEqual({ red_fruit: 2 });
    // The phone says it will read them: the server leaves them alone.
    const c = await as(request(app).post('/api/tastings')).send({ wineId, rating: 4, notes: 'Bright cherry', noteFlavorsPending: true });
    await reader.drained();
    expect(readNoteFlavors).toHaveBeenCalledTimes(2);
    expect((await as(request(app).patch(`/api/tastings/${c.body.tastingId}`)).send({ noteFlavors: { red_fruit: 2, fresh: 2 } })).status).toBe(200);
    const { rows: [fromPhone] } = await db.query('SELECT note_flavors, note_flavors_source FROM tastings WHERE tasting_id = $1', [c.body.tastingId]);
    expect(fromPhone).toEqual({ note_flavors: { red_fruit: 2, fresh: 2 }, note_flavors_source: 'apple' });
    // Unchanged words aren't read again.
    await as(request(app).patch(`/api/tastings/${b.body.tastingId}`)).send({ rating: 3.5 });
    await reader.drained();
    expect(readNoteFlavors).toHaveBeenCalledTimes(2);
  });

  it('uses what a model read over keywords, keywords until then, and lists notes not read yet', async () => {
    const app = createApp({ db, provider: new NullProvider(), fetcher: fetcher(), auth: { allowDev: true }, noteReader: createNoteFlavorReader(db, null) });
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Lytton Springs', grape: 'Zinfandel', colour: 'red', source: 'lwin' });
    const read = await as(request(app).post('/api/tastings')).send({ wineId, rating: 5, notes: 'Not oaky at all, all bramble fruit', noteFlavors: { black_fruit: 3 } });
    const unread = await as(request(app).post('/api/tastings')).send({ wineId, rating: 4, notes: 'Smoky and oaky' });
    const { rows: [u] } = await db.query('SELECT user_id FROM tastings LIMIT 1');

    const { rated } = await loadRatedTastings(db, u.user_id);
    const byId = new Map(rated.map((t) => [t.tastingId, t]));
    // Keywords see "oaky" in a note that says the opposite; the model's reading doesn't.
    expect(byId.get(read.body.tastingId)!.own.keywords.oak).toBe(1.5);
    expect(byId.get(read.body.tastingId)!.own.read).toEqual({ black_fruit: 2 });
    expect(byId.get(unread.body.tastingId)!.own.read).toBeNull();

    const { profile, unread: todo } = await loadProfile(db, u.user_id);
    expect(todo).toEqual([unread.body.tastingId]);
    expect(profile.flavors.get('black_fruit')!.count).toBeGreaterThan(0);
  });
});

describe('evaluation', () => {
  it('measures how often scores put ratings in the right order', () => {
    expect(concordance([3, 2, 1], [5, 4, 3])).toEqual({ value: 1, pairs: 3 });
    expect(concordance([1, 2, 3], [5, 4, 3]).value).toBe(0);
    expect(concordance([1, 1], [5, 4]).value).toBe(0.5);
    expect(concordance([1, 2], [4, 4])).toEqual({ value: null, pairs: 0 });
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });

  it('predicts held-out ratings from the rest, and ranks liked wines against the catalog', () => {
    const f = (o: Record<string, string>) => wineFeatures({ wine_id: 1, display_name: '', producer: '', grape: '', colour: '', wine_type: '', region: '', sub_region: '', country: '', ...o });
    const nebbiolo = (i: number) => f({ display_name: `Barolo ${i}`, producer: `Nebbiolo maker ${i}`, grape: 'Nebbiolo', region: 'Piedmont', sub_region: 'Barolo', country: 'Italy', colour: 'red' });
    const sb = (i: number) => f({ display_name: `Sauvignon Blanc ${i}`, producer: `SB maker ${i}`, grape: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white' });
    const t = (id: number, features: ReturnType<typeof f>, rating: number): RatedTasting => ({
      tastingId: id, wineId: id, rating, priceCents: 4000, features, style: '', own: { keywords: {}, read: null, hasText: false },
    });
    const rated = [t(1, nebbiolo(1), 5), t(2, nebbiolo(2), 5), t(3, nebbiolo(3), 4.5), t(4, sb(1), 2), t(5, sb(2), 2), t(6, sb(3), 2)];
    const catalog = [...Array(10)].map((_, i) => ({ wineId: 100 + i, features: sb(10 + i), priceCents: 4000 }));
    const r = evaluateUser(rated, 'read', catalog);
    expect(r).toMatchObject({ tastings: 6, wines: 6, pairs: 11, liked: 3 });
    // Every Barolo above every Sauvignon Blanc (9 pairs); the 5s vs the 4.5 is close to a coin flip.
    expect(r.concordance).toBeGreaterThanOrEqual(9 / 11);
    expect(r.spearman).toBeGreaterThanOrEqual(0.8);
    // Every liked Barolo outranks every Sauvignon Blanc in the catalog.
    expect(r.likedMedianPct).toBe(0);
    expect(r.likedTop5).toBe(1);
  });
});
