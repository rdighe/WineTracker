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
import { cell, lwinRow } from '../src/catalog/lwin.js';
import { matchWine } from '../src/match/matcher.js';
import { aggregateWines } from '../src/prices/aggregate.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'no-merge': { type: 'boolean', default: false } } });
const file = positionals[0];
if (!file) {
  console.error('usage: npm run import:lwin -- path/to/LWINdatabase.xlsx [--no-merge]');
  process.exit(1);
}

const db = createPool();
// The whole workbook is loaded at once (~2.5 GB RAM for the full dictionary):
// LWIN's xlsx uses a zip layout ExcelJS's streaming reader rejects.
console.log(`reading ${file} ...`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
if (!ws) throw new Error('no worksheet');
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
for (let i = 1; i <= ws.rowCount; i++) {
  const cells = (ws.getRow(i).values as unknown[]).slice(1);
  if (!header) {
    header = cells.map((h) => cell(h).toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    if (!header.includes('lwin')) throw new Error(`no LWIN column in header: ${header.join(', ')}`);
    continue;
  }
  const rec: Record<string, unknown> = {};
  header.forEach((h, j) => (rec[h] = cells[j]));
  const w = lwinRow(rec);
  if (w) batch.push(w);
  else skipped++;
  if (batch.length >= 2000) await flush();
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
