/**
 * Copy one person's data (tastings, cellar, saved wines, learned label texts)
 * from one WineTracker database to another - e.g. from a local development
 * database into the production one - under the account they sign in with
 * there.
 *
 *   tsx scripts/copy-user-data.ts --from <local DATABASE_URL> --to <production DATABASE_URL> \
 *     --from-user dev:rohan --to-email you@example.com [--dry-run]
 *
 * Without --from-user it lists the accounts in the source database (local
 * development accounts are "dev:<the name you signed in with>").
 *
 * The two databases have different wine ids for wines added since they were
 * split (scans of new wines, Vivino imports), so each wine is matched by
 * LWIN, then by id with the same name, then by normalized producer + name;
 * wines found in none of those ways are created in the target. Safe to run
 * again: copied tastings carry an external reference and are skipped the
 * second time.
 *
 * Sign in to the production app once first, so the target account exists.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { createWine } from '../src/catalog/wines.js';
import { createPool } from '../src/db/pool.js';
import { createTasting } from '../src/tastings/tastings.js';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    'to-email': { type: 'string' },
    'from-user': { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.from || !values.to || !values['to-email']) {
  console.error('usage: tsx scripts/copy-user-data.ts --from <url> --to <url> --from-user <account> --to-email <email> [--dry-run]');
  process.exit(1);
}

const src = createPool(values.from);
if (!values['from-user']?.length) {
  const { rows } = await src.query(
    `SELECT u.auth_sub, u.email, COUNT(t.tasting_id)::int AS tastings FROM users u LEFT JOIN tastings t USING (user_id)
      GROUP BY u.user_id ORDER BY tastings DESC`
  );
  console.log('Accounts in the source database (pick yours with --from-user):');
  for (const r of rows) console.log(`  ${r.auth_sub}${r.email ? ` <${r.email}>` : ''}: ${r.tastings} tastings`);
  await src.end();
  process.exit(1);
}
const dst = createPool(values.to);
const dry = values['dry-run'];

type WineRow = Record<string, unknown> & { wine_id: number; lwin: string | null; display_name: string; producer_norm: string; search_norm: string };

const wineMap = new Map<number, number>();
let created = 0;

async function mapWine(client: pg.PoolClient, srcId: number): Promise<number> {
  const known = wineMap.get(srcId);
  if (known) return known;
  const { rows: [w] } = await src.query<WineRow>('SELECT * FROM wines WHERE wine_id = $1', [srcId]);
  if (!w) throw new Error(`source wine ${srcId} not found`);
  let id: number | undefined;
  if (w.lwin) id = (await client.query('SELECT wine_id FROM wines WHERE lwin = $1', [w.lwin])).rows[0]?.wine_id;
  id ??= (await client.query('SELECT wine_id FROM wines WHERE wine_id = $1 AND display_name = $2', [w.wine_id, w.display_name])).rows[0]?.wine_id;
  id ??= (await client.query(
    'SELECT wine_id FROM wines WHERE producer_norm = $1 AND search_norm = $2 ORDER BY (lwin IS NOT NULL) DESC, wine_id LIMIT 1',
    [w.producer_norm, w.search_norm]
  )).rows[0]?.wine_id;
  if (!id) {
    id = await createWine(client, {
      producer: String(w.producer), name: String(w.name), display_name: w.display_name,
      country: String(w.country ?? ''), region: String(w.region ?? ''), sub_region: String(w.sub_region ?? ''),
      colour: String(w.colour ?? ''), wine_type: String(w.wine_type ?? ''), grape: String(w.grape ?? ''),
      classification: String(w.classification ?? ''), source: 'user',
    });
    created++;
    console.log(`  new wine in target: ${w.display_name}`);
  }
  wineMap.set(srcId, id);
  return id;
}

const client = await dst.connect();
try {
  const { rows: [target] } = await client.query('SELECT user_id FROM users WHERE lower(email) = lower($1)', [values['to-email']]);
  if (!target) throw new Error(`no account with email ${values['to-email']} in the target database: sign in to the app there once, then run this again`);

  const fromUsers = (await src.query('SELECT user_id, auth_sub FROM users WHERE auth_sub = ANY($1)', [values['from-user']])).rows;
  const missing = values['from-user']!.filter((a) => !fromUsers.some((u) => u.auth_sub === a));
  if (missing.length) throw new Error(`not in the source database: ${missing.join(', ')} (run without --from-user to list accounts)`);
  const ids = fromUsers.map((u) => u.user_id);
  console.log(`copying from ${fromUsers.map((u) => u.auth_sub).join(', ')} to ${values['to-email']}${dry ? ' (dry run)' : ''}`);

  await client.query('BEGIN');
  const { rows: tastings } = await src.query(
    `SELECT *, to_char(tasted_on, 'YYYY-MM-DD') AS tasted_on_s FROM tastings WHERE user_id = ANY($1) ORDER BY tasting_id`,
    [ids]
  );
  let copied = 0;
  let skipped = 0;
  for (const t of tastings) {
    const newId = await createTasting(client, target.user_id, {
      wineId: await mapWine(client, t.wine_id),
      vintage: t.vintage_key,
      rating: t.rating === null ? null : Number(t.rating),
      notes: t.notes,
      tags: t.tags,
      pricePaid: t.price_paid_cents === null ? null : t.price_paid_cents / 100,
      priceContext: t.price_context,
      bottleMl: t.bottle_ml,
      location: t.location,
      setting: t.setting ?? null,
      tastedOn: t.tasted_on_s,
      kind: t.kind,
      bottles: t.bottles,
      // Vivino imports keep their reference, so a later Vivino import doesn't duplicate them either.
      externalRef: t.external_ref ?? `copy:${t.user_id}:${t.tasting_id}`,
    });
    if (newId === null) skipped++;
    else copied++;
  }

  const { rows: saved } = await src.query('SELECT * FROM saved_wines WHERE user_id = ANY($1)', [ids]);
  let savedNew = 0;
  for (const s of saved) {
    const r = await client.query(
      'INSERT INTO saved_wines (user_id, wine_id, vintage_key, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [target.user_id, await mapWine(client, s.wine_id), s.vintage_key, s.created_at]
    );
    savedNew += r.rowCount ?? 0;
  }

  // Label texts learned from this person's confirmed scans (the scans themselves stay behind).
  const { rows: labels } = await src.query(
    `SELECT l.wine_id, l.tokens FROM label_texts l JOIN scans s ON s.scan_id = l.scan_id WHERE s.user_id = ANY($1)`,
    [ids]
  );
  let learned = 0;
  for (const l of labels) {
    const wineId = await mapWine(client, l.wine_id);
    const dup = await client.query('SELECT 1 FROM label_texts WHERE wine_id = $1 AND tokens = $2', [wineId, l.tokens]);
    if (dup.rows[0]) continue;
    await client.query('INSERT INTO label_texts (wine_id, tokens) VALUES ($1, $2)', [wineId, l.tokens]);
    learned++;
  }

  if (dry) await client.query('ROLLBACK');
  else await client.query('COMMIT');
  console.log(`${dry ? 'would copy' : 'copied'}: ${copied} tastings (${skipped} already there), ${savedNew} saved wines, ${learned} label texts; ${created} wines created in the target`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  client.release();
  await src.end();
  await dst.end();
}
