import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { createAuthenticator, AuthError } from '../src/auth/auth.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const SECRET = 'test-secret-with-enough-length-0123456789';
const token = (sub: string, secret = SECRET, exp = '1h') =>
  new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(secret));

describe('authenticator', () => {
  it('accepts a valid Supabase-style HS256 token and creates the user once', async () => {
    const a = createAuthenticator(db, { jwtSecret: SECRET });
    const u1 = await a.authenticate(`Bearer ${await token('abc')}`);
    const u2 = await a.authenticate(`Bearer ${await token('abc')}`);
    expect(u1.userId).toBe(u2.userId);
    const { rows } = await db.query('SELECT auth_sub, email FROM users');
    expect(rows).toEqual([{ auth_sub: 'abc', email: 'abc@example.com' }]);
  });

  it('rejects bad signatures, expired tokens and missing credentials', async () => {
    const a = createAuthenticator(db, { jwtSecret: SECRET });
    await expect(a.authenticate(`Bearer ${await token('abc', 'another-secret-another-secret-0123')}`)).rejects.toBeInstanceOf(AuthError);
    await expect(a.authenticate(`Bearer ${await token('abc', SECRET, '-1m')}`)).rejects.toBeInstanceOf(AuthError);
    await expect(a.authenticate(undefined)).rejects.toBeInstanceOf(AuthError);
  });

  it('accepts Dev credentials only when enabled', async () => {
    await expect(createAuthenticator(db, { jwtSecret: SECRET }).authenticate('Dev alice')).rejects.toBeInstanceOf(AuthError);
    const u = await createAuthenticator(db, { allowDev: true }).authenticate('Dev alice');
    expect(u.authSub).toBe('dev:alice');
  });
});
