import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import { createApp } from '../src/api/app.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const BUNDLE_ID = 'com.example.winetracker';
const SECRET = 'session-secret-with-enough-length-0123456789';
const fetcher = new PoliteFetcher({ userAgent: 'WineTrackerBot/0.1', fetch: vi.fn(async () => new Response('', { status: 404 })) });

// Stand-in for Apple's signing key, and a key Apple doesn't have.
let appleKey: CryptoKey;
let otherKey: CryptoKey;
let keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  appleKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'apple-1', alg: 'RS256' }] });
});

const identityToken = (claims: Record<string, unknown> = {}, key = appleKey) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: 'https://appleid.apple.com', aud: BUNDLE_ID, sub: 'apple-user-7', email: 'someone@privaterelay.appleid.com',
    iat: now, exp: now + 600, ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'apple-1' }).sign(key);
};

const appWith = () =>
  createApp({ db, provider: new NullProvider(), fetcher, auth: { sessionSecret: SECRET }, apple: { bundleIds: [BUNDLE_ID], keys } });

describe('Sign in with Apple', () => {
  it('turns an Apple identity token into a session, one user per Apple account', async () => {
    const app = appWith();
    const res = await request(app).post('/api/auth/apple').send({ identityToken: await identityToken() });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('someone@privaterelay.appleid.com');
    expect((await request(app).get('/api/tastings').set('Authorization', `Bearer ${res.body.token}`)).status).toBe(200);

    // Apple may leave the email out of later tokens: the saved one stays.
    expect((await request(app).post('/api/auth/apple').send({ identityToken: await identityToken({ email: undefined }) })).status).toBe(200);
    const { rows } = await db.query('SELECT auth_sub, email FROM users');
    expect(rows).toEqual([{ auth_sub: 'apple:apple-user-7', email: 'someone@privaterelay.appleid.com' }]);
  });

  it('rejects tokens for another app, from another issuer, or not signed by Apple', async () => {
    const app = appWith();
    for (const token of [
      await identityToken({ aud: 'com.someone.else' }),
      await identityToken({ iss: 'https://evil.example' }),
      await identityToken({}, otherKey),
      'not-a-token',
    ]) {
      expect((await request(app).post('/api/auth/apple').send({ identityToken: token })).status).toBe(401);
    }
    expect((await request(app).post('/api/auth/apple').send({})).status).toBe(400);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n).toBe(0);
  });

  it('is listed in /api/health only when configured', async () => {
    expect((await request(appWith()).get('/api/health')).body.signIn).toEqual(['apple']);
    const dev = createApp({ db, provider: new NullProvider(), fetcher, auth: { allowDev: true } });
    expect((await request(dev).post('/api/auth/apple').send({ identityToken: 'x' })).status).toBe(404);
  });
});
