import type pg from 'pg';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://wt:wt@localhost:5432/winetracker_test';

let pool: pg.Pool | null = null;

/** Migrated test database; every table is truncated by resetDb(). */
export async function testDb(): Promise<pg.Pool> {
  if (!pool) {
    pool = createPool(URL);
    await migrate(pool, () => {});
  }
  return pool;
}

export async function resetDb(db: pg.Pool): Promise<void> {
  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`
  );
  await db.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
