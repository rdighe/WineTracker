/**
 * Apply a catalog curation plan (src/catalog/curate.ts):
 *
 *   tsx scripts/curate.ts data/curation/2026-10-27-lafleur.json --dry-run   # shows the plan, changes nothing
 *   tsx scripts/curate.ts data/curation/2026-10-27-lafleur.json
 */
import { readFileSync } from 'node:fs';
import { createPool } from '../src/db/pool.js';
import { applyCuration, planSchema } from '../src/catalog/curate.js';
import { getWine } from '../src/catalog/wines.js';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: tsx scripts/curate.ts <plan.json> [--dry-run]');
  process.exit(1);
}
const plan = planSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
const db = createPool();
if (plan.note) console.log(plan.note);
if (process.argv.includes('--dry-run')) {
  const name = async (id: number) => (await getWine(db, id))?.display_name ?? '(already gone)';
  for (const m of plan.merge) for (const f of m.from) console.log(`merge ${f} "${await name(f)}" -> ${m.into} "${await name(m.into)}"`);
  for (const { id, ...p } of plan.update) console.log(`update ${id} "${await name(id)}": ${JSON.stringify(p)}`);
  for (const a of plan.dropAliases) console.log(`drop alias "${a.alias}" from ${a.id} "${await name(a.id)}"`);
  for (const a of plan.addAliases) console.log(`add alias "${a.alias}" to ${a.id} "${await name(a.id)}"`);
  for (const id of plan.remove) console.log(`remove ${id} "${await name(id)}"`);
} else {
  await applyCuration(db, plan);
  console.log('done');
}
await db.end();
