import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createWine } from '../src/catalog/wines.js';
import { quantityAndUnit, receiptFacts } from '../src/cellars/receipts.js';
import { NullProvider } from '../src/llm/index.js';
import type { ListEntry } from '../src/llm/types.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const app = (readWineList?: (text: string) => Promise<ListEntry[]>) => {
  const reader = Object.assign(new NullProvider(), { name: 'gemini', ...(readWineList ? { readWineList } : {}) });
  return createApp({ db, provider: reader, pickReaders: [reader], pickJev: {}, fetcher: new PoliteFetcher({ userAgent: 'x', fetch: vi.fn() }), auth: { allowDev: true } });
};
const as = (who: string) => ({ Authorization: `Dev ${who}` });

describe('cellars', () => {
  it('everyone gets a cellar; bottles go in it, with what they cost and are worth', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Monte Bello', source: 'lwin' });
    await db.query(
      `INSERT INTO wine_prices (wine_id, vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at)
       VALUES ($1, '2016', 30000, 28000, 32000, 3, 2, 30, NOW())`,
      [wineId]
    );
    await request(a).post('/api/tastings').set(as('rohan')).send({ wineId, vintage: '2016', kind: 'cellar', bottles: 3, pricePaid: 200 });
    // A half bottle with no market price counts at what it cost.
    const other = await createWine(db, { producer: 'Chateau Suduiraut', name: '', source: 'lwin' });
    await request(a).post('/api/tastings').set(as('rohan')).send({ wineId: other, kind: 'cellar', bottles: 1, pricePaid: 40, bottleMl: 375 });
    const { cellars } = (await request(a).get('/api/cellars').set(as('rohan'))).body;
    expect(cellars).toHaveLength(1);
    expect(cellars[0]).toMatchObject({
      name: 'My cellar', role: 'owner', bottles: 4, wines: 2, costCents: 64000, valueCents: 94000, pairedCostCents: 60000, pairedValueCents: 90000, unpriced: 1,
      members: [{ role: 'owner', me: true }],
    });
    const list = (await request(a).get('/api/tastings').set(as('rohan'))).body.tastings;
    expect(list.every((t: { cellar_id: number; can_edit: boolean }) => t.cellar_id === cellars[0].cellarId && t.can_edit)).toBe(true);
  });

  it('several cellars: add to one, move between them, delete only an empty one', async () => {
    const a = app();
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Geyserville', source: 'user' });
    const home = (await request(a).get('/api/cellars').set(as('r'))).body.cellars[0].cellarId;
    const locker = (await request(a).post('/api/cellars').set(as('r')).send({ name: 'Locker' })).body.cellarId;
    const t = (await request(a).post('/api/tastings').set(as('r')).send({ wineId, kind: 'cellar', bottles: 2, cellarId: locker })).body.tastingId;
    expect((await request(a).delete(`/api/cellars/${locker}`).set(as('r'))).status).toBe(409);
    await request(a).patch(`/api/tastings/${t}`).set(as('r')).send({ cellarId: home });
    expect((await request(a).delete(`/api/cellars/${locker}`).set(as('r'))).status).toBe(204);
    // Someone else's cellar is out of reach.
    const theirs = (await request(a).post('/api/cellars').set(as('m')).send({ name: 'Mine' })).body.cellarId;
    expect((await request(a).post('/api/tastings').set(as('r')).send({ wineId, kind: 'cellar', cellarId: theirs })).status).toBe(404);
  });

  it('shares a cellar by invite: editors change bottles, viewers only look, owners decide', async () => {
    const a = app();
    for (const who of ['ann', 'ben', 'cat']) await request(a).get('/api/me').set(as(who));
    await db.query(`UPDATE users SET display_name = initcap(substr(auth_sub, 5))`);
    const wineId = await createWine(db, { producer: 'Ridge', name: 'Geyserville', source: 'user' });
    const t = (await request(a).post('/api/tastings').set(as('ann')).send({ wineId, kind: 'cellar', bottles: 6 })).body.tastingId;
    const cellarId = (await request(a).get('/api/cellars').set(as('ann'))).body.cellars[0].cellarId;
    // Only owners invite.
    const inv = (await request(a).post(`/api/cellars/${cellarId}/invites`).set(as('ann')).send({ role: 'editor' })).body;
    expect(inv.code).toMatch(/^[a-z0-9]{10}$/);
    expect((await request(a).get(`/api/cellar-invites/${inv.code}`).set(as('ben'))).body).toMatchObject({ cellarName: 'My cellar', from: 'Ann', role: 'editor', member: false });
    expect((await request(a).post(`/api/cellar-invites/${inv.code}/accept`).set(as('ben'))).body).toEqual({ cellarId });
    // Once only.
    expect((await request(a).post(`/api/cellar-invites/${inv.code}/accept`).set(as('cat'))).status).toBe(410);

    // Ben sees Ann's bottles (it's Ben's only cellar, so no empty one is made), and can drink one.
    const benList = (await request(a).get('/api/tastings').set(as('ben'))).body.tastings;
    expect(benList).toMatchObject([{ tasting_id: t, bottles: 6, added_by: 'Ann', can_edit: true }]);
    expect((await request(a).patch(`/api/tastings/${t}`).set(as('ben')).send({ bottles: 5 })).status).toBe(200);
    const benCellars = (await request(a).get('/api/cellars').set(as('ben'))).body.cellars;
    expect(benCellars.map((c: { name: string; role: string }) => [c.name, c.role])).toEqual([['My cellar', 'editor']]);
    expect((await request(a).post(`/api/cellars/${cellarId}/invites`).set(as('ben')).send({})).status).toBe(403);

    // A viewer can't change anything.
    const v = (await request(a).post(`/api/cellars/${cellarId}/invites`).set(as('ann')).send({ role: 'viewer' })).body.code;
    await request(a).post(`/api/cellar-invites/${v}/accept`).set(as('cat'));
    expect((await request(a).get('/api/tastings').set(as('cat'))).body.tastings[0]).toMatchObject({ bottles: 5, can_edit: false });
    expect((await request(a).patch(`/api/tastings/${t}`).set(as('cat')).send({ bottles: 1 })).status).toBe(403);
    expect((await request(a).delete(`/api/tastings/${t}`).set(as('cat'))).status).toBe(403);

    // There's always an owner; leaving keeps the bottles.
    const annId = (await db.query(`SELECT user_id FROM users WHERE auth_sub = 'dev:ann'`)).rows[0].user_id;
    const benId = (await db.query(`SELECT user_id FROM users WHERE auth_sub = 'dev:ben'`)).rows[0].user_id;
    expect((await request(a).delete(`/api/cellars/${cellarId}/members/${annId}`).set(as('ann'))).status).toBe(409);
    await request(a).patch(`/api/cellars/${cellarId}/members/${benId}`).set(as('ann')).send({ role: 'owner' });
    expect((await request(a).delete(`/api/cellars/${cellarId}/members/${annId}`).set(as('ann'))).status).toBe(204);
    expect((await request(a).get('/api/tastings').set(as('ann'))).body.tastings).toEqual([]);
    expect((await request(a).get('/api/tastings').set(as('ben'))).body.tastings).toMatchObject([{ tasting_id: t, bottles: 5 }]);
  });

  it('racks: places one per bottle, inside the rack, never two bottles in one place', async () => {
    const a = app();
    const ridge = await createWine(db, { producer: 'Ridge', name: 'Geyserville', source: 'user' });
    const t = (await request(a).post('/api/tastings').set(as('r')).send({ wineId: ridge, kind: 'cellar', bottles: 2 })).body.tastingId;
    const u = (await request(a).post('/api/tastings').set(as('r')).send({ wineId: ridge, vintage: '2019', kind: 'cellar', bottles: 1 })).body.tastingId;
    const cellarId = (await request(a).get('/api/cellars').set(as('r'))).body.cellars[0].cellarId;
    const rackId = (await request(a).post(`/api/cellars/${cellarId}/racks`).set(as('r')).send({ name: 'Kitchen', rows: 3, cols: 4 })).body.rackId;

    const put = (id: number, places: { rackId: number; row: number; col: number }[]) => request(a).put(`/api/tastings/${id}/places`).set(as('r')).send({ places });
    expect((await put(t, [{ rackId, row: 0, col: 0 }, { rackId, row: 0, col: 1 }])).status).toBe(200);
    expect((await put(t, [{ rackId, row: 0, col: 0 }, { rackId, row: 0, col: 1 }, { rackId, row: 0, col: 2 }])).status).toBe(400);
    expect((await put(u, [{ rackId, row: 3, col: 0 }])).status).toBe(400);
    expect((await put(u, [{ rackId, row: 0, col: 1 }])).status).toBe(409);
    expect((await put(u, [{ rackId, row: 2, col: 3 }])).status).toBe(200);

    const racks = (await request(a).get(`/api/cellars/${cellarId}/racks`).set(as('r'))).body.racks;
    expect(racks).toMatchObject([{ name: 'Kitchen', rows: 3, cols: 4, slots: [{ row: 0, col: 0, tastingId: t }, { row: 0, col: 1, tastingId: t }, { row: 2, col: 3, tastingId: u, vintage: '2019' }] }]);
    const listed = (await request(a).get('/api/tastings').set(as('r'))).body.tastings.find((x: { tasting_id: number }) => x.tasting_id === t);
    expect(listed.places).toEqual([{ rackId, rack: 'Kitchen', row: 0, col: 0 }, { rackId, rack: 'Kitchen', row: 0, col: 1 }]);

    // Drinking one frees a place; shrinking the rack can't strand a bottle.
    await request(a).patch(`/api/tastings/${t}`).set(as('r')).send({ bottles: 1 });
    expect((await db.query('SELECT COUNT(*)::int AS n FROM cellar_slots WHERE tasting_id = $1', [t])).rows[0].n).toBe(1);
    expect((await request(a).patch(`/api/racks/${rackId}`).set(as('r')).send({ rows: 2 })).status).toBe(409);
    // Out of the cellar: out of the rack.
    await request(a).post(`/api/tastings/${u}/remove-from-cellar`).set(as('r'));
    expect((await request(a).patch(`/api/racks/${rackId}`).set(as('r')).send({ rows: 2, name: 'Kitchen wall' })).status).toBe(200);
    // Find a bottle says where it is.
    const picks = (await request(a).get('/api/cellar/picks').set(as('r'))).body.items;
    expect(picks[0]).toMatchObject({ place: 'Kitchen wall · row 1, place 1', cellar: null });
  });
});

describe('receipts', () => {
  it('reads quantities, unit prices, the shop, date and total off receipt lines', () => {
    expect(quantityAndUnit('2 x Ridge Geyserville 2019 49.98', null)).toEqual({ qty: 2, unitCents: 2499 });
    expect(quantityAndUnit('Ridge Geyserville 2019 | 3 | 24.99 | 74.97', 2499)).toEqual({ qty: 3, unitCents: 2499 });
    expect(quantityAndUnit('Qty 6 Muscadet 2022 $95.94', 9594)).toEqual({ qty: 6, unitCents: 1599 });
    expect(quantityAndUnit('Barolo Vietti 2019 $65.00', 6500)).toEqual({ qty: 1, unitCents: 6500 });
    const facts = receiptFacts('K&L Wine Merchants\n855 Harrison St\nOrder 12345\n10/03/2026 4:12 PM\nSubtotal $120.00\nTax $10.50\nTotal $130.50');
    expect(facts).toEqual({ merchant: 'K&L Wine Merchants', purchasedOn: '2026-10-03', totalCents: 13050 });
    expect(receiptFacts('Invoice\nFlatiron Wines\nOct 3, 2026\nGrand Total 1,240.00').purchasedOn).toBe('2026-10-03');
  });

  it('reads a receipt into matched lines, then files it with its bottles', async () => {
    const ridge = await createWine(db, { producer: 'Ridge', name: 'Geyserville', source: 'lwin' });
    const line = (producer: string, name: string, vintage: string, bottleCents: number, text: string): ListEntry =>
      ({ producer, name, vintage, region: '', country: '', grape: '', colour: '', style: '', section: '', glassCents: null, bottleCents, bottleMl: null, text });
    const readWineList = vi.fn(async () => [
      line('Ridge', 'Geyserville', '2019', 7497, 'Ridge Geyserville 2019 | 3 | 24.99 | 74.97'),
      line('Domaine Nowhere', 'Cuvee Imaginaire', '2021', 1800, 'Domaine Nowhere Cuvee Imaginaire 2021 18.00'),
    ]);
    const a = app(readWineList);
    const read = await request(a).post('/api/receipts/read').set(as('r')).send({
      pages: ['Bay Wine Shop\n10/03/2026\nRidge Geyserville 2019 | 3 | 24.99 | 74.97\nDomaine Nowhere Cuvee Imaginaire 2021 18.00\nTotal $92.97'],
    });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ merchant: 'Bay Wine Shop', purchasedOn: '2026-10-03', totalCents: 9297 });
    expect(read.body.lines).toMatchObject([
      { qty: 3, unitCents: 2499, wineId: ridge, match: 'matched' },
      { qty: 1, unitCents: 1800, wineId: null },
    ]);

    const saved = await request(a).post('/api/receipts').set(as('r')).send({
      merchant: 'Bay Wine Shop', purchasedOn: '2026-10-03', totalCents: 9297,
      photo: { base64: Buffer.from('fake jpeg').toString('base64'), mimeType: 'image/jpeg' },
      lines: [
        { wineId: ridge, vintage: '2019', qty: 3, unitCents: 2499 },
        { producer: 'Domaine Nowhere', name: 'Cuvee Imaginaire', vintage: '2021', qty: 1, unitCents: 1800 },
      ],
    });
    expect(saved.status).toBe(201);
    const list = (await request(a).get('/api/tastings').set(as('r'))).body.tastings;
    expect(list).toHaveLength(2);
    expect(list.map((t: { bottles: number; price_paid_cents: number; tasted_on: string; receipt_id: number }) => [t.bottles, t.price_paid_cents, t.tasted_on, t.receipt_id]))
      .toEqual(expect.arrayContaining([[3, 2499, '2026-10-03', saved.body.receiptId], [1, 1800, '2026-10-03', saved.body.receiptId]]));

    const receipts = (await request(a).get('/api/receipts').set(as('r'))).body.receipts;
    expect(receipts).toMatchObject([{ merchant: 'Bay Wine Shop', purchasedOn: '2026-10-03', totalCents: 9297, bottles: 4, lines: 2, hasPhoto: true, cellarName: 'My cellar' }]);
    const photo = await request(a).get(`/api/receipts/${saved.body.receiptId}/photo`).set(as('r'));
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect((await request(a).get(`/api/receipts/${saved.body.receiptId}`).set(as('m'))).status).toBe(404);

    // Forgetting the receipt keeps the bottles.
    expect((await request(a).delete(`/api/receipts/${saved.body.receiptId}`).set(as('r'))).status).toBe(204);
    expect((await request(a).get('/api/tastings').set(as('r'))).body.tastings.map((t: { receipt_id: number | null }) => t.receipt_id)).toEqual([null, null]);
  });
});
