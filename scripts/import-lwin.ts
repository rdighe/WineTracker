/**
 * Import the LWIN dictionary (Liv-ex, Creative Commons) into the catalog.
 *
 *   npm run import:lwin -- path/to/LWINdatabase.xlsx [--no-merge]
 *
 * Download the XLSX from https://www.liv-ex.com/lwin/ (free; the site's bot
 * check means it has to be fetched in a browser). Re-running is safe: rows
 * are upserted by LWIN.
 *
 * After importing, wines the crawler created ("source = crawl") that match
 * an LWIN wine confidently are merged into it, so prices collected before
 * the import attach to the canonical entry.
 */
import ExcelJS from 'exceljs';
import { parseArgs } from 'node:util';
import { createPool, withTransaction } from '../src/db/pool.js';
import { mergeWines, upsertLwinWine, type NewWine } from '../src/catalog/wines.js';
import { lwinRow } from '../src/catalog/lwin.js';
import { matchWine } from '../src/match/matcher.js';
import { aggregateWines } from '../src/prices/aggregate.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'no-merge': { type: 'boolean', default: false } } });
const file = positionals[0];
if (!file) {
  console.error('usage: npm run import:lwin -- path/to/LWINdatabase.xlsx [--no-merge]');
  process.exit(1);
}

const db = createPool();
const wb = new ExcelJS.stream.xlsx.WorkbookReader(file, { sharedStrings: 'cache', worksheets: 'emit' });
let header: string[] | null = null;
let batch: Array<NewWine & { lwin: string }> = [];
let imported = 0;
let skipped = 0;
const flush = async () => {
  const rows = batch;
  batch = [];
  await withTransaction(db, async (c) => {
    for (const w of rows) await upsertLwinWine(c, w);
  });
  imported += rows.length;
  if (imported % 10000 < rows.length) console.log(`imported ${imported}`);
};

for await (const sheet of wb) {
  for await (const row of sheet) {
    const cells = (row.values as unknown[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' && v && 'text' in v ? String((v as { text: unknown }).text) : String(v)));
    if (!header) {
      header = cells.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
      if (!header.includes('lwin')) throw new Error(`no LWIN column in header: ${header.join(', ')}`);
      continue;
    }
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (cells[i] ?? '').trim()));
    const w = lwinRow(rec);
    if (w) batch.push(w);
    else skipped++;
    if (batch.length >= 1000) await flush();
  }
  break; // first sheet only
}
if (batch.length) await flush();
console.log(`LWIN import done: ${imported} wines upserted, ${skipped} rows skipped`);

if (!values['no-merge']) {
  const { rows } = await db.query(`SELECT wine_id, producer, name, display_name FROM wines WHERE source = 'crawl'`);
  let merged = 0;
  const touched = new Set<number>();
  for (const w of rows) {
    const r = await matchWine(db, { text: w.display_name, producer: w.producer || undefined }, { sources: ['lwin'] });
    if (r.outcome !== 'auto') continue;
    const target = r.candidates[0]!.wine.wine_id;
    await withTransaction(db, (c) => mergeWines(c, w.wine_id, target));
    touched.add(target);
    merged++;
  }
  await aggregateWines(db, [...touched]);
  console.log(`merged ${merged} of ${rows.length} crawl-created wines into LWIN entries`);
}
await db.end();
