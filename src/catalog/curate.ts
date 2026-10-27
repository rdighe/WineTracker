/**
 * Hand curation of the catalog from a plan file (data/curation/*.json):
 * merge duplicate entries into one, correct names and fields, drop aliases
 * that point at the wrong wine, and remove entries that aren't wine.
 *
 * Applying a plan twice changes nothing: merges and removals of wines that
 * are already gone are skipped. Researched background (wine_info) of every
 * wine touched is cleared, so it is researched again under the right name.
 */
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { normalize } from '../lib/normalize.js';
import { aggregateWines } from '../prices/aggregate.js';
import { getWine, mergeWines, updateWine } from './wines.js';

const fields = z
  .object({
    producer: z.string(), name: z.string(), display_name: z.string(), country: z.string(), region: z.string(),
    sub_region: z.string(), colour: z.enum(['red', 'white', 'rose', '']), wine_type: z.string(), grape: z.string(), classification: z.string(),
  })
  .partial()
  .strict();

export const planSchema = z
  .object({
    /** Why: shown when the plan runs. */
    note: z.string().optional(),
    /** Fold every `from` wine into `into`: listings, prices, tastings, saved wines, aliases. */
    merge: z.array(z.object({ into: z.number().int(), from: z.array(z.number().int()).min(1) })).default([]),
    /** Corrected fields (after merging). */
    update: z.array(fields.extend({ id: z.number().int() })).default([]),
    /** Aliases that send scans of one wine to another ("grand village" on Capbern Grand Village). */
    dropAliases: z.array(z.object({ id: z.number().int(), alias: z.string() })).default([]),
    /** Extra names to recognize a wine by. */
    addAliases: z.array(z.object({ id: z.number().int(), alias: z.string() })).default([]),
    /** Not wine at all (shop junk): unlinked from listings and deleted. Refused if anyone tasted or saved it. */
    remove: z.array(z.number().int()).default([]),
  })
  .strict();

export type CurationPlan = z.infer<typeof planSchema>;

export async function applyCuration(db: pg.Pool, plan: CurationPlan, log: (msg: string) => void = console.log): Promise<void> {
  const touched = new Set<number>();
  // Researched info belongs to the old identity; drop it before merging so a wrong one can't move over.
  const allIds = [...plan.merge.flatMap((m) => [m.into, ...m.from]), ...plan.update.map((u) => u.id)];
  await db.query('DELETE FROM wine_info WHERE wine_id = ANY($1)', [allIds]);

  for (const m of plan.merge) {
    if (!(await getWine(db, m.into))) throw new Error(`merge target ${m.into} does not exist`);
    for (const from of m.from) {
      const w = await getWine(db, from);
      if (!w) continue;
      await withTransaction(db, (c) => mergeWines(c, from, m.into));
      log(`merged ${from} "${w.display_name}" -> ${m.into}`);
    }
    touched.add(m.into);
  }
  for (const { id, ...patch } of plan.update) {
    if (!(await getWine(db, id))) throw new Error(`update target ${id} does not exist`);
    await updateWine(db, id, patch);
    log(`updated ${id}: ${JSON.stringify(patch)}`);
  }
  for (const a of plan.dropAliases) {
    const { rowCount } = await db.query('DELETE FROM wine_aliases WHERE wine_id = $1 AND alias_norm = $2', [a.id, normalize(a.alias)]);
    if (rowCount) log(`dropped alias "${a.alias}" from ${a.id}`);
  }
  for (const a of plan.addAliases) {
    await db.query(`INSERT INTO wine_aliases (wine_id, alias_norm, source) VALUES ($1, $2, 'curation') ON CONFLICT DO NOTHING`, [a.id, normalize(a.alias)]);
  }
  for (const id of plan.remove) {
    const w = await getWine(db, id);
    if (!w) continue;
    const used = await db.query('SELECT (SELECT COUNT(*) FROM tastings WHERE wine_id = $1) + (SELECT COUNT(*) FROM saved_wines WHERE wine_id = $1) AS n', [id]);
    if (Number(used.rows[0].n) > 0) throw new Error(`refusing to remove ${id} "${w.display_name}": someone tasted or saved it`);
    await withTransaction(db, async (c) => {
      await c.query(`UPDATE listings SET wine_id = NULL, match_status = 'not_wine' WHERE wine_id = $1`, [id]);
      await c.query('DELETE FROM price_observations WHERE wine_id = $1', [id]);
      await c.query('UPDATE scans SET chosen_wine_id = NULL WHERE chosen_wine_id = $1', [id]);
      await c.query('DELETE FROM wines WHERE wine_id = $1', [id]);
    });
    log(`removed ${id} "${w.display_name}"`);
  }
  if (touched.size) await aggregateWines(db, [...touched]);
}
