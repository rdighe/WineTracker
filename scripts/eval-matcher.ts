/**
 * Matcher accuracy on the labelled cases in test/fixtures/matcher-cases.ts,
 * against the fixture catalog, in the test database.
 *
 *   npm run eval:matcher
 *
 * Reports top-1 accuracy, how often the right wine is in the top 3, the
 * auto-match rate, and wrong auto-matches (the costly error).
 */
import { createWine } from '../src/catalog/wines.js';
import { matchWine } from '../src/match/matcher.js';
import { closeDb, resetDb, testDb } from '../test/helpers.js';
import { CATALOG } from '../test/fixtures/catalog.js';
import { MATCH_CASES } from '../test/fixtures/matcher-cases.js';

const db = await testDb();
await resetDb(db);
const ids = new Map<number, string>();
for (const { key, ...w } of CATALOG) ids.set(await createWine(db, w), key);

let top1 = 0, top3 = 0, auto = 0, wrongAuto = 0, positives = 0;
for (const c of MATCH_CASES) {
  const r = await matchWine(db, { text: c.q, producer: c.producer, name: c.name });
  const keys = r.candidates.slice(0, 3).map((x) => ids.get(x.wine.wine_id));
  const isAuto = r.outcome === 'auto';
  if (isAuto) auto++;
  if (c.expect === null) {
    if (isAuto) {
      wrongAuto++;
      console.log(`WRONG AUTO  ${c.q} -> ${keys[0]}`);
    }
    continue;
  }
  positives++;
  if (keys[0] === c.expect) top1++;
  else console.log(`MISS        ${c.q} -> ${keys[0]} (expected ${c.expect})`);
  if (keys.includes(c.expect)) top3++;
  if (isAuto && keys[0] !== c.expect) {
    wrongAuto++;
    console.log(`WRONG AUTO  ${c.q} -> ${keys[0]}`);
  }
}
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
console.log(`cases=${MATCH_CASES.length} top1=${pct(top1, positives)} top3=${pct(top3, positives)} auto=${pct(auto, MATCH_CASES.length)} wrongAuto=${wrongAuto}`);
await closeDb();
