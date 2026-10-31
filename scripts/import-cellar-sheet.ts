/**
 * Import a cellar spreadsheet (the GSB Wine Circle "Cellar Tracker Audit" workbook, converted to JSON rows)
 * into a named cellar of one account.
 *
 *   tsx scripts/import-cellar-sheet.ts --rows cellar.json --db <DATABASE_URL> --cellar "GSB Wine Cellar" \
 *     (--email you@example.com | --auth-sub apple:xxxx | --user-id 7) [--apply]
 *
 * Without --apply nothing is written: it shows the account and cellar it found and what it would add.
 * Rows with no bottles left are skipped. Each row is remembered (external_ref "sheet:gsb:<row>"),
 * so running it again adds only what's new.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createPool } from '../src/db/pool.js';
import { cellarForNew } from '../src/cellars/cellars.js';
import { createTasting } from '../src/tastings/tastings.js';
import { WineResolver } from '../src/imports/resolve.js';

const { values: v } = parseArgs({
  options: {
    rows: { type: 'string' }, db: { type: 'string' }, cellar: { type: 'string' }, email: { type: 'string' },
    'auth-sub': { type: 'string' }, 'user-id': { type: 'string' }, apply: { type: 'boolean', default: false },
  },
});
if (!v.rows || !v.db || !v.cellar) {
  console.error('usage: tsx scripts/import-cellar-sheet.ts --rows f.json --db URL --cellar NAME (--email E | --auth-sub S | --user-id N) [--apply]');
  process.exit(1);
}
interface Row { row: number; producer: string | null; label: string | null; appellation: string | null; type: string | null; vintage: number | null; ml: number | null;
  shelf: number | null; section: string | null; rowpos: string | null; purpose: string | null; event: string | null; source: string | null;
  acquired: string | null; cost: number | null; qty: number | null; window: string | null; sourcedBy: string | null; notes: string | null }
const rows = (JSON.parse(readFileSync(v.rows, 'utf8')) as Row[]).filter((r) => (r.qty ?? 0) > 0);
console.log(`${rows.length} rows with bottles, ${rows.reduce((n, r) => n + (r.qty ?? 0), 0)} bottles`);

const db = createPool(v.db);
const { rows: users } = await db.query(
  `SELECT user_id, auth_sub, email FROM users WHERE ($1::text IS NOT NULL AND lower(email) = lower($1)) OR auth_sub = $2 OR user_id = $3::bigint`,
  [v.email ?? null, v['auth-sub'] ?? null, v['user-id'] ?? null]
);
if (users.length !== 1) {
  console.error(`Expected one account, found ${users.length}:`, users);
  process.exit(1);
}
const user = users[0];
const { rows: cellars } = await db.query(
  `SELECT c.cellar_id, c.name, m.role FROM cellars c JOIN cellar_members m USING (cellar_id) WHERE m.user_id = $1 AND lower(c.name) = lower($2)`,
  [user.user_id, v.cellar]
);
if (cellars.length !== 1) {
  console.error(`Expected one cellar named "${v.cellar}" for ${user.auth_sub}, found ${cellars.length}:`, cellars);
  process.exit(1);
}
const cellarId = await cellarForNew(db, Number(user.user_id), Number(cellars[0].cellar_id)); // checks edit rights
console.log(`Account ${user.auth_sub} <${user.email ?? ''}> -> cellar #${cellarId} "${cellars[0].name}" (${cellars[0].role})`);
if (!v.apply) {
  console.log('Dry run: nothing written. Add --apply to import.');
  await db.end();
  process.exit(0);
}

const colour = (t: string | null) => (/white/i.test(t ?? '') ? 'white' : /red/i.test(t ?? '') ? 'red' : /ros/i.test(t ?? '') ? 'rose' : '');
const wineType = (t: string | null) => (/sparkling/i.test(t ?? '') ? 'sparkling' : /sweet|dessert/i.test(t ?? '') ? 'dessert' : /fortified/i.test(t ?? '') ? 'fortified' : '');
const resolver = new WineResolver(db);
let added = 0, skipped = 0, bottles = 0;
for (const r of rows) {
  const producer = (r.producer ?? '').trim();
  const label = (r.label ?? '').trim();
  const name = label && label.toLowerCase() !== producer.toLowerCase() ? label : '';
  const wineId = await resolver.resolve({ producer, name, region: r.appellation ?? '', colour: colour(r.type), wineType: wineType(r.type) });
  const place = [r.section, r.shelf != null ? `shelf ${r.shelf}` : '', r.rowpos].filter(Boolean).join(' · ');
  const notes = [r.event && `Event: ${r.event}`, r.purpose && `Purpose: ${r.purpose}`, r.source && `Source: ${r.source}`,
    r.window && `Drinking window: ${r.window}`, r.sourcedBy && `Sourced by: ${r.sourcedBy}`, r.notes].filter(Boolean).join('\n').slice(0, 4000);
  const id = await createTasting(db, Number(user.user_id), {
    wineId, vintage: r.vintage ? String(Math.round(r.vintage)) : 'NV', kind: 'cellar', bottles: r.qty!, cellarId,
    pricePaid: r.cost && r.cost > 0 ? r.cost : null, bottleMl: r.ml ?? 750, location: place.slice(0, 200), notes,
    tastedOn: r.acquired && r.acquired <= new Date().toISOString().slice(0, 10) ? r.acquired : undefined,
    externalRef: `sheet:gsb:${r.row}`,
  });
  if (id === null) skipped++;
  else { added++; bottles += r.qty!; }
}
console.log(`Added ${added} entries (${bottles} bottles); ${skipped} already there; ${resolver.matched} wines matched, ${resolver.added} new.`);
await db.end();
