import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { applyCuration, planSchema } from '../src/catalog/curate.js';
import { addAlias, type NewWine } from '../src/catalog/wines.js';
import { producerNorm, searchNorm, wineTokens, displayName } from '../src/catalog/wines.js';
import type { LabelRead } from '../src/llm/types.js';
import { matchLabel } from '../src/scan/scan.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

/** A wine with a fixed id, as in production. */
async function wine(id: number, w: Omit<NewWine, 'display_name'> & { display_name?: string }, aliases: string[] = []) {
  await db.query(
    `INSERT INTO wines (wine_id, lwin, producer, name, display_name, country, region, sub_region, colour, grape, source, producer_norm, search_norm, tokens)
     OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, w.lwin ?? null, w.producer, w.name, w.display_name ?? displayName(w), w.country ?? '', w.region ?? '', w.sub_region ?? '', w.colour ?? '', w.grape ?? '',
     w.source, producerNorm(w.producer), searchNorm(w as NewWine), wineTokens(w)]
  );
  for (const a of aliases) await addAlias(db, id, a, 'lwin');
}

const label = (r: Partial<LabelRead>): LabelRead => ({
  producer: '', name: '', vintage: '', region: '', country: '', grape: '', colour: '', bottleMl: null, rawText: '', confidence: 0.95, ...r,
});
const SMALL_PRINT = 'SOCIÉTÉ CIVILE DU CHÂTEAU LAFLEUR GUINAUDEAU VIGNERONS PROPRIETAIRES';

/** The production rows involved (2026-10-27), trimmed to what matching uses. */
async function lafleurCatalog() {
  await wine(65257, { lwin: '1011902', producer: 'Lafleur', name: '', colour: 'red', country: 'France', source: 'lwin' }, ['chateau lafleur']);
  await wine(138104, { lwin: '1892958', producer: 'Domaine Lafleur', name: '', display_name: 'Domaine Lafleur, Pomerol', region: 'Bordeaux', sub_region: 'Pomerol', colour: 'red', source: 'lwin' }, ['chateau lafleur pomerol']);
  await wine(165890, { lwin: '2207687', producer: 'Domaine Lafleur', name: 'N°2', display_name: 'N°2, Domaine Lafleur, Pomerol', region: 'Bordeaux', sub_region: 'Pomerol', colour: 'red', source: 'lwin' });
  await wine(65450, { lwin: '1013935', producer: 'Lafleur', name: 'Les Pensees', display_name: 'Les Pensees, Lafleur, VdF', colour: 'red', source: 'lwin' }, ['pensees de lafleur']);
  await wine(38479, { producer: '', name: 'Pensees de Lafleur Pomerol', region: 'Bordeaux', sub_region: 'Pomerol', colour: 'red', source: 'crawl' });
  await wine(75680, { lwin: '1131530', producer: 'Lafleur', name: 'Les Perrieres', display_name: 'Les Perrieres, Lafleur, VdF', colour: 'red', source: 'lwin' }, ['les perrieres de lafleur']);
  for (const [id, producer, sub] of [[67832, 'Maison Louis Latour', 'Beaune'], [68486, 'Domaine de Montille', 'Beaune'], [75102, 'Jean-Michel Gaunoux', 'Pommard'], [75116, 'Domaine Meo Camuzet', 'Corton']] as const) {
    await wine(id, { producer, name: 'Les Perrieres', display_name: `${producer}, ${sub}, Les Perrieres`, region: 'Burgundy', sub_region: sub, colour: 'red', source: 'lwin' });
  }
  for (const id of [36955, 286504, 275981]) await wine(id, { producer: '', name: `Les Perrieres de Lafleur Bordeaux Superieur ${id}`, source: 'crawl' });
  await wine(305942, { producer: 'Les Perrières', name: '', colour: 'white', country: 'Switzerland', region: 'Geneva', grape: 'Chasselas', source: 'user' }, ['les perrieres']);
  await wine(102069, { lwin: '1446395', producer: 'Guinaudeau', name: 'Les Champs Libres', display_name: 'Guinaudeau, Les Champs Libres, VdF', colour: 'white', source: 'lwin' });
  for (const [id, name] of [[24113, 'Les Champs Libres'], [52459, 'Les Champs Libres Bordeaux Blanc'], [302047, 'Chateau Lafleur Les Champs Libres Blanc'], [261194, "Chateau Grand Village Bordeaux Blanc 'Les Champs Libres'"]] as const) {
    await wine(id, { producer: '', name, source: 'crawl' });
  }
  await wine(248826, { lwin: '3117707', producer: 'Hugel', name: "Cremant d'Alsace, Champs Libres", display_name: "Hugel, Cremant d'Alsace, Champs Libres", source: 'lwin' });
  await wine(169026, { lwin: '2241832', producer: 'Chateau Capbern', name: 'Capbern Grand Village', display_name: 'Capbern Grand Village, Saint-Estephe', region: 'Bordeaux', sub_region: 'Saint-Estephe', colour: 'red', source: 'lwin' }, ['grand village']);
  await wine(65152, { lwin: '1010804', producer: 'Le Grand Village', name: '', display_name: 'Le Grand Village, VdF', colour: 'red', source: 'lwin' });
  await wine(65735, { lwin: '1017018', producer: 'Le Grand Village', name: 'Blanc', display_name: 'Le Grand Village, Blanc, VdF', colour: 'white', source: 'lwin' }, ['grand village blanc']);
  for (const [id, producer, name] of [[261164, 'Chateau Grand Village', 'Bordeaux Superieur'], [302211, '', 'Chateau Grand Village, Bordeaux'], [286554, '', 'Societe Civile du Chateau Lafleur Chateau Grand Village Bordeaux Superieur Rouge'], [275665, '', 'Château Grand Village Rouge, Bordeaux Supérieur'], [261179, 'Chateau Grand Village', 'Bordeaux Blanc'], [30765, 'Chateau Lafleur', 'Grand Village BLANC Fronsac']] as const) {
    await wine(id, { producer, name, source: 'crawl' });
  }
  await wine(298568, { producer: '', name: 'xx Chateau Lafleur Restaurant only', source: 'crawl' });
}

const plan = planSchema.parse(JSON.parse(readFileSync('data/curation/2026-10-27-lafleur.json', 'utf8')));

describe('curation plans', () => {
  it('applies the Lafleur plan, and applying it again changes nothing', async () => {
    await lafleurCatalog();
    const user = (await db.query(`INSERT INTO users (auth_sub, email) VALUES ('google:1', 'a@b.c') RETURNING user_id`)).rows[0].user_id;
    await db.query(`INSERT INTO tastings (user_id, wine_id, vintage_key, rating) VALUES ($1, 138104, '2015', 5), ($1, 305942, '2023', 4)`, [user]);
    await db.query(`INSERT INTO wine_info (wine_id, status, info) VALUES (305942, 'ready', '{"summary": "A Swiss Chasselas"}')`);

    await applyCuration(db, plan, () => {});
    const names = async (ids: number[]) => (await db.query('SELECT wine_id, display_name FROM wines WHERE wine_id = ANY($1) ORDER BY wine_id', [ids])).rows;
    expect(await names([65257, 138104, 165890])).toEqual([
      { wine_id: 65257, display_name: 'Lafleur' },
      { wine_id: 165890, display_name: 'N°2, Lafleur, Pomerol' },
    ]);
    expect((await db.query('SELECT wine_id, vintage_key FROM tastings ORDER BY wine_id')).rows).toEqual([
      { wine_id: 65257, vintage_key: '2015' },
      { wine_id: 75680, vintage_key: '2023' },
    ]);
    // The wrong research (a Swiss wine) is gone, not moved onto Lafleur's Perrieres.
    expect((await db.query('SELECT COUNT(*)::int AS n FROM wine_info')).rows[0].n).toBe(0);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM wines WHERE wine_id = 298568')).rows[0].n).toBe(0);

    const before = (await db.query('SELECT COUNT(*)::int AS n FROM wines')).rows[0].n;
    await applyCuration(db, plan, () => {});
    expect((await db.query('SELECT COUNT(*)::int AS n FROM wines')).rows[0].n).toBe(before);
  });

  it('then recognizes every bottle of the tasting photo', async () => {
    await lafleurCatalog();
    await applyCuration(db, plan, () => {});
    // What Gemini read off each bottle of the photo, left to right.
    const reads: [Partial<LabelRead>, number][] = [
      [{ producer: 'CHÂTEAU GRAND VILLAGE', vintage: '2023', rawText: `CHÂTEAU GRAND VILLAGE 2023 ${SMALL_PRINT}` }, 65152],
      [{ producer: 'Les Perrières', vintage: '2023', rawText: `Les Perrières ${SMALL_PRINT} 2023` }, 75680],
      [{ producer: 'Les Pensées', name: 'Pomerol', region: 'Pomerol', vintage: '2023', rawText: `Les Pensées de Lafleur Pomerol 2023 ${SMALL_PRINT}` }, 65450],
      [{ producer: 'Ch. Lafleur', name: 'Pomerol', region: 'Pomerol', vintage: '2023', rawText: 'Ch. Lafleur Pomerol 2023 MIS EN BOUTEILLE AU CHATEAU GRELOUD FONDÉE EN 1872 GUINAUDEAU' }, 65257],
      [{ producer: 'Ch. Lafleur', name: 'Pomerol', region: 'Pomerol', vintage: '2015', rawText: 'Ch. Lafleur Pomerol 2015 MIS EN BOUTEILLE AU CHATEAU A.Greloud FONDÉE EN 1872' }, 65257],
      [{ producer: 'Les Champs Libres', vintage: '2022', rawText: `Les Champs Libres 2022 ${SMALL_PRINT}` }, 102069],
    ];
    for (const [read, expected] of reads) {
      const r = await matchLabel(db, label(read));
      expect({ read: read.producer, top: r.candidates[0]?.wine.wine_id }).toEqual({ read: read.producer, top: expected });
    }
  });
});
