import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWine } from '../src/catalog/wines.js';
import { matchLabelText, vintageFromText } from '../src/match/text-match.js';
import { CATALOG } from './fixtures/catalog.js';
import { closeDb, resetDb, testDb } from './helpers.js';

const db = await testDb();
const keyOf = new Map<number, string>();

beforeAll(async () => {
  await resetDb(db);
  for (const { key, ...w } of CATALOG) keyOf.set(await createWine(db, w), key);
});
afterAll(closeDb);

// OCR text as PaddleOCR read real label photos, plus typical label noise.
const CASES: Array<{ text: string; expect: string | null; vintage?: string | null }> = [
  { text: 'DENNER INEYARDS 2016 DITCHDIGGER', expect: 'denner-ditch', vintage: '2016' },
  { text: 'TERTRE ROTEBOEUF 1999 SAINT-EMILION GRAND CRU LATINANANONRLE MA MISEN BOUTEILE AU CHATEAU', expect: 'tertre-roteboeuf', vintage: '1999' },
  { text: 'CHATEAU ACONSELANTE 2016 e 88 G G POMEROL HERITIERS LOUIS NICOLAS PROPRIETAIRES DEPUIS 1871', expect: null, vintage: '2016' },
  { text: 'GRAND VIN DE CHATEAU LYNCH-BAGES PAUILLAC 2016 APPELLATION PAUILLAC CONTROLEE MIS EN BOUTEILLE AU CHATEAU', expect: 'lynch-bages' },
  { text: 'ECHO DE LYNCH-BAGES PAUILLAC 2018 13% VOL', expect: 'echo-lynch-bages' },
  { text: 'CAYMUS ZINFANDEL NAPA VALLEY 2020', expect: null },
  { text: 'CHATEAU COUTET 2017 GRAND CRU CLASSE', expect: null },
  { text: 'CHATEAU COUTET BARSAC 2017 PREMIER CRU', expect: 'coutet-barsac' },
  { text: 'DELAMOTTE BRUT CHAMPAGNE LE MESNIL SUR OGER', expect: null },
  { text: 'MIS EN BOUTEILLE AU CHATEAU PRODUCT OF FRANCE 750 ML', expect: null },
];

describe('matchLabelText', () => {
  for (const c of CASES) {
    it(`${c.text.slice(0, 50)} -> ${c.expect}`, async () => {
      const r = await matchLabelText(db, c.text);
      expect(r.outcome).toBe(c.expect ? 'auto' : 'unsure');
      expect(r.wine ? keyOf.get(r.wine.wine_id) : null).toBe(c.expect);
      if (c.vintage !== undefined) expect(r.vintage).toBe(c.vintage);
    });
  }
});

describe('vintageFromText', () => {
  it('ignores founding years and implausible numbers', () => {
    expect(vintageFromText('PROPRIETAIRES DEPUIS 1871 2016')).toBe('2016');
    expect(vintageFromText('Since 1985 · 2019 Cabernet')).toBe('2019');
    expect(vintageFromText('No 007740 2030')).toBeNull();
    expect(vintageFromText('2015 2016')).toBeNull();
  });
});
