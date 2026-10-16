import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { createAuthenticator, createSessionToken, AuthError } from '../src/auth/auth.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const SECRET = 'session-secret-with-enough-length-0123456789';
const token = (sub: string, secret = SECRET) => createSessionToken(secret, sub, `${sub}@example.com`);

describe('authenticator', () => {
  it('accepts a session token and creates the user once', async () => {
    const a = createAuthenticator(db, { sessionSecret: SECRET });
    const u1 = await a.authenticate(`Bearer ${await token('google:abc')}`);
    const u2 = await a.authenticate(`Bearer ${await token('google:abc')}`);
    expect(u1.userId).toBe(u2.userId);
    const { rows } = await db.query('SELECT auth_sub, email FROM users');
    expect(rows).toEqual([{ auth_sub: 'google:abc', email: 'google:abc@example.com' }]);
  });

  it('rejects bad signatures, expired or foreign tokens, and missing credentials', async () => {
    const a = createAuthenticator(db, { sessionSecret: SECRET });
    await expect(a.authenticate(`Bearer ${await token('abc', `${SECRET}x`)}`)).rejects.toBeInstanceOf(AuthError);
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('abc').setIssuer('winetracker').setAudience('winetracker').setExpirationTime('-1m').sign(new TextEncoder().encode(SECRET));
    await expect(a.authenticate(`Bearer ${expired}`)).rejects.toBeInstanceOf(AuthError);
    // A Supabase-style token signed with the same secret, but not issued by WineTracker.
    const foreign = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('abc').setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    await expect(a.authenticate(`Bearer ${foreign}`)).rejects.toBeInstanceOf(AuthError);
    await expect(a.authenticate(undefined)).rejects.toBeInstanceOf(AuthError);
    await expect(createAuthenticator(db, {}).authenticate(`Bearer ${await token('abc')}`)).rejects.toBeInstanceOf(AuthError);
  });

  it('accepts Dev credentials only when enabled', async () => {
    await expect(createAuthenticator(db, { sessionSecret: SECRET }).authenticate('Dev alice')).rejects.toBeInstanceOf(AuthError);
    const u = await createAuthenticator(db, { allowDev: true }).authenticate('Dev alice');
    expect(u.authSub).toBe('dev:alice');
  });
});
