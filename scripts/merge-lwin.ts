/**
 * Resumable merge of crawl-created wines into LWIN entries (the step
 * import-lwin runs after importing; use this to continue it in chunks).
 *
 *   tsx scripts/merge-lwin.ts [--limit 10000] [--restart]
 *
 * Progress is saved in data/review/merge-lwin.cursor after every batch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createPool } from '../src/db/pool.js';
import { mergeCrawlIntoLwin } from '../src/catalog/lwin-merge.js';

const { values } = parseArgs({ options: { limit: { type: 'string', default: '10000' }, restart: { type: 'boolean', default: false } } });
const CURSOR = 'data/review/merge-lwin.cursor';
mkdirSync('data/review', { recursive: true });
let cursor = !values.restart && existsSync(CURSOR) ? Number(readFileSync(CURSOR, 'utf8')) : 0;
const limit = Number(values.limit);
const db = createPool();
let checked = 0;
let merged = 0;
while (checked < limit) {
  const r = await mergeCrawlIntoLwin(db, cursor, Math.min(500, limit - checked));
  if (r.cursor === null) {
    console.log('all crawl-created wines checked');
    break;
  }
  cursor = r.cursor;
  writeFileSync(CURSOR, String(cursor));
  checked += r.checked;
  merged += r.merged;
  console.log(`${new Date().toISOString()} checked ${checked}, merged ${merged} (cursor ${cursor})`);
}
await db.end();
