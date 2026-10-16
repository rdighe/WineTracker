import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createWine } from '../src/catalog/wines.js';
import type { LabelRead, LlmProvider } from '../src/llm/types.js';
import { confirmScan, scanLabel } from '../src/scan/scan.js';
import { CATALOG } from './fixtures/catalog.js';
import { closeDb, resetDb, testDb } from './helpers.js';

const db = await testDb();
const ids = new Map<string, number>();

beforeAll(async () => {
  await resetDb(db);
  for (const { key, ...w } of CATALOG) ids.set(key, await createWine(db, w));
});
afterAll(closeDb);

const read = (r: Partial<LabelRead>): LabelRead => ({
  producer: '', name: '', vintage: '', region: '', country: '', grape: '', colour: '', bottleMl: null, rawText: '', confidence: 0.9, ...r,
});
const llm = (r: Partial<LabelRead>) => ({ name: 'fake', readLabel: vi.fn(async () => read(r)), searchPrices: vi.fn(async () => []) }) satisfies LlmProvider;
let n = 0;
const photo = () => Buffer.from(`photo-${n++}`);

describe('scans with phone OCR text', () => {
  it('identifies a clearly printed label without calling the LLM', async () => {
    const provider = llm({});
    const r = await scanLabel(db, provider, photo(), 'image/jpeg', { ocrText: 'DENNER VINEYARDS 2016 DITCHDIGGER' });
    expect(r.outcome).toBe('auto');
    expect(r.candidates[0]!.wineId).toBe(ids.get('denner-ditch'));
    expect(r.vintage).toBe('2016');
    expect(r.source).toBe('ocr');
    expect(provider.readLabel).not.toHaveBeenCalled();
    const { rows } = await db.query('SELECT provider, ocr_text FROM scans WHERE scan_id = $1', [r.scanId]);
    expect(rows[0]).toEqual({ provider: 'ocr', ocr_text: 'DENNER VINEYARDS 2016 DITCHDIGGER' });
  });

  it('learns a garbled label from a confirmed scan and recognizes it next time without the LLM', async () => {
    const garbled = 'CHATAU RIDGQ MNTE BELO SANTA CRUZ MOUNTAINS 2018 ESTATE GROWN';
    const provider = llm({ producer: 'Ridge Vineyards', name: 'Monte Bello', vintage: '2018' });
    const first = await scanLabel(db, provider, photo(), 'image/jpeg', { ocrText: garbled });
    expect(provider.readLabel).toHaveBeenCalledTimes(1);
    await confirmScan(db, first.scanId, { wineId: ids.get('ridge-mb')! });

    // Another photo of the same label, misread a little differently
    const again = await scanLabel(db, provider, photo(), 'image/jpeg', { ocrText: 'CHATAU RIDGQ MNTE BELO SANTA CRUZ MOUNTAINS 2019 ESTATE' });
    expect(provider.readLabel).toHaveBeenCalledTimes(1);
    expect(again.outcome).toBe('auto');
    expect(again.candidates[0]!.wineId).toBe(ids.get('ridge-mb'));
    expect(again.vintage).toBe('2019');
    const { rows } = await db.query('SELECT provider FROM scans WHERE scan_id = $1', [again.scanId]);
    expect(rows[0].provider).toBe('ocr-learned');
  });

  it('never lets a learned label override a different wine printed on the label', async () => {
    const provider = llm({ producer: 'Ridge Vineyards', name: 'Geyserville' });
    // Same garbled words, but the label clearly prints another Ridge wine
    const r = await scanLabel(db, provider, photo(), 'image/jpeg', { ocrText: 'CHATAU RIDGQ MNTE BELO SANTA CRUZ MOUNTAINS RIDGE GEYSERVILLE 2018' });
    expect(r.candidates[0]!.wineId).toBe(ids.get('ridge-geyserville'));
  });

  it('falls back to the LLM when the text identifies nothing', async () => {
    const provider = llm({ producer: 'Caymus Vineyards', name: 'Special Selection Cabernet Sauvignon' });
    const r = await scanLabel(db, provider, photo(), 'image/jpeg', { ocrText: 'PRODUCT OF FRANCE 750 ML' });
    expect(provider.readLabel).toHaveBeenCalledTimes(1);
    expect(r.candidates[0]!.wineId).toBe(ids.get('caymus-ss'));
  });
});
