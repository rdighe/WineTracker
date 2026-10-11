import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { addAlias, createWine } from '../src/catalog/wines.js';
import { matchWine } from '../src/match/matcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';
import { CATALOG } from './fixtures/catalog.js';
import { MATCH_CASES } from './fixtures/matcher-cases.js';

let db: pg.Pool;
const ids = new Map<string, number>();
const keyOf = (id: number | undefined) => [...ids].find(([, v]) => v === id)?.[0] ?? null;

beforeAll(async () => {
  db = await testDb();
  await resetDb(db);
  for (const { key, ...w } of CATALOG) ids.set(key, await createWine(db, w));
});
afterAll(closeDb);

describe('matchWine', () => {
  for (const c of MATCH_CASES) {
    it(`${c.q} -> ${c.expect ?? '(no auto match)'}`, async () => {
      const r = await matchWine(db, { text: c.q, producer: c.producer, name: c.name });
      if (c.expect === null) {
        expect(r.outcome === 'auto' ? keyOf(r.candidates[0]?.wine.wine_id) : null).toBeNull();
      } else {
        expect(keyOf(r.candidates[0]?.wine.wine_id)).toBe(c.expect);
        expect(r.outcome).not.toBe('new');
      }
    });
  }

  it('learns from aliases', async () => {
    const before = await matchWine(db, { text: 'Antinori Tig 2019' });
    expect(before.outcome).not.toBe('auto');
    await addAlias(db, ids.get('tignanello')!, 'Antinori Tig', 'manual');
    const after = await matchWine(db, { text: 'Antinori Tig 2019' });
    expect(keyOf(after.candidates[0]?.wine.wine_id)).toBe('tignanello');
  });
});
