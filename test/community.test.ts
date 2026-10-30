import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const app = () => createApp({ db, provider: new NullProvider(), fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
const as = (who: string) => ({ Authorization: `Dev ${who}` });

describe('community notes', () => {
  it('shares a tasting as a note without its score, under a public name, never an email', async () => {
    const a = app();
    for (const who of ['ann', 'ben']) await request(a).get('/api/me').set(as(who));
    await db.query(`UPDATE users SET display_name = 'Ann Lee', email = 'ann@example.com' WHERE auth_sub = 'dev:ann'`);
    const wineId = await createWine(db, { producer: 'Lisini', name: 'Brunello di Montalcino', region: 'Tuscany', country: 'Italy', colour: 'red', source: 'lwin' });
    const t = (await request(a).post('/api/tastings').set(as('ann')).send({ wineId, vintage: '1997', rating: 4, notes: 'private thought' })).body.tastingId;
    // Private until shared.
    expect((await request(a).get('/api/community').set(as('ben'))).body.notes).toEqual([]);

    const shared = await request(a).post('/api/community').set(as('ann')).send({ tastingId: t, reaction: 'liked', maturity: 'past_prime', body: 'Very young for its age. Slightly on the decline.' });
    expect(shared.status).toBe(201);
    const feed = (await request(a).get('/api/community').set(as('ben'))).body.notes;
    expect(feed).toMatchObject([{ author: { name: 'Ann L.', notes: 1, me: false }, vintage: '1997', reaction: 'liked', maturity: 'past_prime', likes: 0, replies: 0,
      wine: { wineId, displayName: 'Lisini Brunello di Montalcino', region: 'Tuscany' } }]);
    expect(JSON.stringify(feed)).not.toMatch(/ann@example|rating|private thought|"4"/);
    expect((await request(a).get('/api/tastings').set(as('ann'))).body.tastings[0].note_id).toBe(shared.body.noteId);
    // Sharing the same tasting again updates the note.
    await request(a).post('/api/community').set(as('ann')).send({ tastingId: t, reaction: 'loved' });
    expect((await request(a).get(`/api/community?wineId=${wineId}`).set(as('ben'))).body.notes).toMatchObject([{ reaction: 'loved' }]);

    // A chosen name wins.
    await request(a).patch('/api/me').set(as('ann')).send({ publicName: 'aharv' });
    expect((await request(a).get('/api/community').set(as('ben'))).body.notes[0].author.name).toBe('aharv');
  });

  it('likes, replies, reports (three hide it), and only the author edits or deletes', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    const noteId = (await request(a).post('/api/community').set(as('ann')).send({ wineId, vintage: '2016', reaction: 'loved', body: 'Cedar and cassis.' })).body.noteId;
    await request(a).put(`/api/community/${noteId}/like`).set(as('ben'));
    await request(a).put(`/api/community/${noteId}/like`).set(as('ben'));
    const r = (await request(a).post(`/api/community/${noteId}/replies`).set(as('ben')).send({ body: 'Agreed!' })).body.replyId;
    const one = (await request(a).get(`/api/community/${noteId}`).set(as('ben'))).body;
    expect(one.note).toMatchObject({ likes: 1, liked: true, replies: 1 });
    expect(one.replies).toMatchObject([{ replyId: r, body: 'Agreed!', author: { me: true } }]);
    expect((await request(a).patch(`/api/community/${noteId}`).set(as('ben')).send({ body: 'hijack' })).status).toBe(404);
    expect((await request(a).delete(`/api/community/${noteId}`).set(as('ben'))).status).toBe(404);
    // The author can remove a reply on their note.
    expect((await request(a).delete(`/api/community/replies/${r}`).set(as('ann'))).status).toBe(204);

    expect((await request(a).post(`/api/community/${noteId}/report`).set(as('ann')).send({})).status).toBe(400);
    for (const who of ['ben', 'cat', 'dan']) await request(a).post(`/api/community/${noteId}/report`).set(as(who)).send({ reason: 'spam' });
    expect((await request(a).get('/api/community').set(as('ben'))).body.notes).toEqual([]);
    // Still there for its author, marked hidden.
    expect((await request(a).get('/api/community?mine=true').set(as('ann'))).body.notes).toMatchObject([{ noteId, hidden: true }]);
    expect((await request(a).delete(`/api/community/${noteId}`).set(as('ann'))).status).toBe(204);
  });

  it('blocks someone: nothing of theirs shows for you, until you unblock', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    const noteId = (await request(a).post('/api/community').set(as('troll')).send({ wineId, reaction: 'not_for_me', body: 'meh' })).body.noteId;
    expect((await request(a).post(`/api/community/${noteId}/block`).set(as('troll'))).status).toBe(400);
    expect((await request(a).post(`/api/community/${noteId}/block`).set(as('ann'))).status).toBe(204);
    expect((await request(a).get('/api/community').set(as('ann'))).body.notes).toEqual([]);
    expect((await request(a).get('/api/community').set(as('ben'))).body.notes).toHaveLength(1);
    expect((await request(a).delete('/api/community-blocks').set(as('ann'))).body).toEqual({ unblocked: 1 });
    expect((await request(a).get('/api/community').set(as('ann'))).body.notes).toHaveLength(1);
  });
});
