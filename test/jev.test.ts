import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { JevClient, jevNoteReader, type JevAnswer, type JevQuestion } from '../src/llm/jev.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { evaluateJev } from '../src/recs/evaluate.js';
import { wineFeatures } from '../src/recs/features.js';
import { forgetRecommendationCandidates, type RatedTasting } from '../src/recs/recommend.js';
import { forgetPickMatches } from '../src/picks/picks.js';
import { closeDb, resetDb, testDb } from './helpers.js';

/** A stand-in for Jev: answers each question with `answer(question, state)`. */
function fakeJev(answer: (q: JevQuestion, name: string, state: string) => JevAnswer | undefined) {
  const ask = vi.fn(async (state: string, questions: Record<string, JevQuestion>) => {
    const out: Record<string, JevAnswer> = {};
    for (const [name, q] of Object.entries(questions)) {
      const a = answer(q, name, state);
      if (a) out[name] = a;
    }
    return out;
  });
  return Object.assign(new JevClient({ apiKey: 'k' }), { ask }) as JevClient & { ask: typeof ask };
}

describe('Jev client', () => {
  it('asks OpenRouter with typed questions and reads choice, score and yes/no answers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'x', model: 'typesafe/jev-1.13',
      answers: {
        tone: { type: 'choice', choice: 'calm', confidence: 0.7, probabilities: { angry: 0.2, calm: 0.8 } },
        urgency: { type: 'score', score: 1.7, confidence: 0.55, legend: { 0: 'a', 1: 'b', 2: 'c' }, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 } },
        refund: { type: 'noul', noul: 0.98 },
        junk: { type: 'score', score: 'high' },
      },
    }), { status: 200 }));
    const jev = new JevClient({ apiKey: 'k', fetch });
    const answers = await jev.ask('I want a refund, now.', {
      tone: { type: 'choice', instructions: 'Tone?', criteria: { angry: 'Upset', calm: 'Polite' } },
      urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Can wait', 'Soon', 'Now'] },
      refund: { type: 'noul', instructions: 'Asking for a refund?' },
      junk: { type: 'score', instructions: '?', criteria: ['a', 'b'] },
    });
    expect(answers).toEqual({
      tone: { type: 'choice', choice: 'calm', confidence: 0.7, probabilities: { angry: 0.2, calm: 0.8 } },
      urgency: { type: 'score', score: 1.7, confidence: 0.55, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 } },
      refund: { type: 'noul', noul: 0.98 },
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'typesafe/jev-1.13', state: 'I want a refund, now.', questions: { urgency: { type: 'score', criteria: ['Can wait', 'Soon', 'Now'] } } });

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'no credits' } }), { status: 402 }));
    await expect(jev.ask('x', { a: { type: 'noul', instructions: '?' } })).rejects.toThrow(/402: no credits/);
  });

  it('reads flavors from a note as one score per family', async () => {
    const jev = fakeJev((q, name) => (q.type === 'score' ? { type: 'score', score: name === 'oak' ? 0.2 : name === 'red_fruit' ? 2.6 : name === 'fresh' ? 1.1 : 0, confidence: 0.8, probabilities: {} } : undefined));
    expect(await jevNoteReader(jev).readNoteFlavors!('Bright cherry, not oaky at all')).toEqual({ red_fruit: 3, fresh: 1 });
    expect(Object.keys(jev.ask.mock.calls[0]![1])).toHaveLength(20);
  });
});

describe('Jev in picks', () => {
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

  it('settles a match the matcher is unsure of, and can rule one out', async () => {
    await priced({ producer: 'Vietti', name: 'Barolo Castiglione', sub_region: 'Barolo', ...neb }, 6000);
    const rocche = await priced({ producer: 'Vietti', name: 'Barolo Rocche di Castiglione', sub_region: 'Barolo', ...neb }, 15000);
    // Jev picks the Rocche when it is among the options; says "none" for anything about Barbaresco.
    const match = fakeJev((q, _n, state) => {
      if (q.type !== 'choice') return undefined;
      if (state.includes('Barbaresco')) return { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9 } };
      const key = Object.entries(q.criteria).find(([, d]) => d.includes('Rocche'))?.[0] ?? 'none';
      return { type: 'choice', choice: key, confidence: 0.9, probabilities: { [key]: 0.9 } };
    });
    const app = createApp({ db, provider: new NullProvider(), pickJev: { match }, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const r = await as(request(app).post('/api/picks')).send({ kind: 'list', entries: [
      { producer: 'Vietti', name: 'Barolo', bottleCents: 30000 },
      { producer: 'Vietti', name: 'Barbaresco Masseria', bottleCents: 20000 },
    ] });
    const [barolo, barbaresco] = [0, 1].map((i) => r.body.items.find((x: { index: number }) => x.index === i));
    expect(barolo).toMatchObject({ match: 'matched', wineId: rocche, markup: 2 });
    expect(barbaresco).toMatchObject({ match: 'guess', wineId: null });
    expect(match.ask).toHaveBeenCalledTimes(2);
    // Later (the memory of recent matches gone, as after a restart): Jev's decisions are kept, not asked again.
    forgetPickMatches();
    const again = await as(request(app).post('/api/picks')).send({ kind: 'list', entries: [{ producer: 'Vietti', name: 'Barolo', bottleCents: 30000 }] });
    expect(again.body.items[0]).toMatchObject({ match: 'matched', wineId: rocche });
    expect(match.ask).toHaveBeenCalledTimes(2);
  });

  it('blends predictions into the ranking, and shows them', async () => {
    const ids = {
      vietti: await priced({ producer: 'Vietti', name: 'Barolo Castiglione', sub_region: 'Barolo', ...neb }, 6000),
      produttori: await priced({ producer: 'Produttori del Barbaresco', name: 'Barbaresco', sub_region: 'Barbaresco', ...neb }, 5000),
      sb: await priced({ producer: 'Kim Crawford', name: 'Sauvignon Blanc', region: 'Marlborough', country: 'New Zealand', colour: 'white', source: 'crawl' }, 1500),
    };
    const app0 = createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    for (const [wineId, rating] of [[ids.vietti, 5], [ids.produttori, 4.5], [ids.sb, 2]] as const) await as(request(app0).post('/api/tastings')).send({ wineId, rating });
    // Jev is sure they'd love the Sancerre and dislike the Nebbiolo: enough to swap them.
    const predict = fakeJev((q, _n, state) => {
      if (q.type !== 'score') return undefined;
      expect(state).toContain('Vietti Barolo Castiglione');
      return { type: 'score', score: q.instructions.includes('Sancerre') ? 4 : 0, confidence: 0.9, probabilities: {} };
    });
    const app = createApp({ db, provider: new NullProvider(), pickJev: { predict }, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
    const list = { kind: 'list', entries: [{ producer: 'Domaine Vacheron', name: 'Sancerre', grape: 'Sauvignon Blanc', colour: 'white', bottleCents: 9000 }, { producer: 'Cascina Fontana', name: 'Langhe Nebbiolo', grape: 'Nebbiolo', colour: 'red', bottleCents: 7000 }] };
    const before = await as(request(app0).post('/api/picks')).send(list);
    expect(before.body.items[0].entry.producer).toBe('Cascina Fontana');
    const after = await as(request(app).post('/api/picks')).send(list);
    expect(after.body.items.map((i: { entry: { producer: string }; jevScore: number }) => [i.entry.producer, i.jevScore])).toEqual([['Domaine Vacheron', 4], ['Cascina Fontana', 0]]);
    expect(predict.ask).toHaveBeenCalledTimes(1);
    // Scored again with the same ratings (saved, reopened): kept predictions, no new call.
    const again = await as(request(app).post('/api/picks')).send(list);
    expect(again.body.items[0].jevScore).toBe(4);
    expect(predict.ask).toHaveBeenCalledTimes(1);
    // A new rating changes the palate: asked afresh.
    await as(request(app0).post('/api/tastings')).send({ wineId: ids.sb, rating: 3 });
    await as(request(app).post('/api/picks')).send(list);
    expect(predict.ask).toHaveBeenCalledTimes(2);
  });
});

describe('Jev in the evaluation', () => {
  it('measures predictions left one out at a time, alone and blended', async () => {
    const f = (o: Record<string, string>) => wineFeatures({ wine_id: 1, display_name: '', producer: '', grape: '', colour: '', wine_type: '', region: '', sub_region: '', country: '', ...o });
    const t = (id: number, grape: string, rating: number): RatedTasting => ({
      tastingId: id, wineId: id, rating, priceCents: 4000, label: `${grape} ${id}`, features: f({ display_name: `${grape} ${id}`, producer: `P${id}`, grape }), style: '', own: { keywords: {}, read: null, hasText: false },
    });
    const rated = [t(1, 'Nebbiolo', 5), t(2, 'Nebbiolo', 4.5), t(3, 'Nebbiolo', 4), t(4, 'Sauvignon Blanc', 2), t(5, 'Sauvignon Blanc', 2.5)];
    // A prediction that is exactly right (rating - 1, on Jev's 0-4 scale), except one it can't answer.
    const r = await evaluateJev(rated, async (_others, wine) => (wine.wineId === 5 ? null : wine.rating - 1));
    expect(r).toMatchObject({ wines: 5, answered: 4 });
    expect(r.jev.concordance).toBe(1);
    expect(r.blended.concordance).toBeGreaterThanOrEqual(r.profile.concordance!);
  });
});
