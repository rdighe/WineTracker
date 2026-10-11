/**
 * Minimal migration runner: applies src/db/migrations/NNN_*.sql in order, each
 * in its own transaction, recording applied files in schema_migrations.
 * (Wine Circle re-ran one big schema.sql by hand; numbered migrations make
 * production and local databases provably identical.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool, withTransaction } from './pool.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await withTransaction(pool, async (c) => {
      await c.query(readFileSync(join(DIR, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    log(`applied ${f}`);
    applied.push(f);
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pool = createPool();
  migrate(pool)
    .then((a) => console.log(a.length ? `${a.length} migration(s) applied` : 'up to date'))
    .finally(() => pool.end());
}
