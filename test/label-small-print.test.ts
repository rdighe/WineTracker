import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createWine } from '../src/catalog/wines.js';
import type { LabelRead } from '../src/llm/types.js';
import { matchLabel } from '../src/scan/scan.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const label = (r: Partial<LabelRead>): LabelRead => ({
  producer: '', name: '', vintage: '', region: '', country: '', grape: '', colour: '', bottleMl: null, rawText: '', confidence: 0.95, ...r,
});

describe('matching a label whose name many wines share', () => {
  async function perrieres() {
    // Real catalog entries: four Burgundy vineyards called "Les Perrieres", and Lafleur's wine.
    for (const [producer, sub] of [['Maison Louis Latour', 'Beaune'], ['Domaine de Montille', 'Beaune'], ['Jean-Michel Gaunoux', 'Pommard'], ['Domaine Meo Camuzet', 'Corton']] as const) {
      await createWine(db, { producer, name: 'Les Perrieres', region: 'Burgundy', sub_region: sub, colour: 'red', source: 'lwin' });
    }
    return createWine(db, { producer: 'Lafleur', name: 'Les Perrieres', display_name: 'Les Perrieres, Lafleur, VdF', colour: 'red', source: 'lwin' });
  }

  it('lets the producer in the small print decide', async () => {
    const lafleur = await perrieres();
    const r = await matchLabel(db, label({ producer: 'Les Perrières', vintage: '2023', rawText: 'Les Perrières SOCIÉTÉ CIVILE DU CHÂTEAU LAFLEUR 2023 GUINAUDEAU VIGNERONS PROPRIETAIRES' }));
    expect(r.candidates[0]!.wine.wine_id).toBe(lafleur);
    expect(r.outcome).toBe('auto');
  });

  it('still asks when the label names none of them', async () => {
    await perrieres();
    const r = await matchLabel(db, label({ producer: 'Les Perrières', vintage: '2023', rawText: 'Les Perrières 2023' }));
    expect(r.outcome).toBe('choose');
  });

  it('tells a numbered cuvee from the grand vin', async () => {
    const grandVin = await createWine(db, { producer: 'Lafleur', name: '', display_name: 'Lafleur', region: 'Bordeaux', sub_region: 'Pomerol', colour: 'red', source: 'lwin' });
    await createWine(db, { producer: 'Lafleur', name: 'N°2', display_name: 'N°2, Lafleur, Pomerol', region: 'Bordeaux', sub_region: 'Pomerol', colour: 'red', source: 'lwin' });
    const r = await matchLabel(db, label({ producer: 'Ch. Lafleur', name: 'Pomerol', region: 'Pomerol', vintage: '2015', rawText: 'Ch. Lafleur Pomerol 2015 MIS EN BOUTEILLE AU CHATEAU' }));
    expect(r.candidates[0]!.wine.wine_id).toBe(grandVin);
    expect(r.outcome).toBe('auto');
  });
});
