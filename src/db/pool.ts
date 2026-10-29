import pg from 'pg';
import { config } from '../config.js';

// BIGINT ids come back as strings by default; they stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.Pool | pg.PoolClient;

// Enough for a list's matches (8 at once, src/picks/picks.ts) with room for everyone else.
export function createPool(url = config.databaseUrl): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 15 });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
