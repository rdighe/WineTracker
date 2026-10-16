import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/api/app.js';
import { isAllowedRedirect } from '../src/auth/google.js';
import { NullProvider } from '../src/llm/index.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { closeDb, resetDb, testDb } from './helpers.js';

let db: pg.Pool;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});
afterAll(closeDb);

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const SECRET = 'session-secret-with-enough-length-0123456789';
const fetcher = new PoliteFetcher({ userAgent: 'WineTrackerBot/0.1', fetch: vi.fn(async () => new Response('', { status: 404 })) });

// An unsigned ID token: the API trusts the token endpoint's TLS, not the signature.
const idToken = (claims: Record<string, unknown>) =>
  ['{"alg":"RS256"}', JSON.stringify(claims), 'sig'].map((p, i) => (i < 2 ? Buffer.from(p).toString('base64url') : p)).join('.');

function appWith(googleFetch: typeof fetch) {
  return createApp({
    db,
    provider: new NullProvider(),
    fetcher,
    auth: { sessionSecret: SECRET },
    google: { clientId: CLIENT_ID, clientSecret: 'shh', appSchemes: ['winetracker', 'exp'], publicUrl: 'https://api.example.com', fetch: googleFetch },
    allowedOrigins: ['http://localhost:8081'],
  });
}

/** Runs /start, then Google's redirect to /callback with the given ID-token claims. */
async function signIn(claims: (nonce: string) => Record<string, unknown>, redirect = 'winetracker://auth') {
  const googleFetch = vi.fn<typeof fetch>();
  const app = appWith(googleFetch);
  const start = await request(app).get('/api/auth/google/start').query({ redirect });
  expect(start.status).toBe(302);
  const google = new URL(start.headers.location!);
  googleFetch.mockResolvedValue(Response.json({ id_token: idToken(claims(google.searchParams.get('nonce')!)) }));
  const cb = await request(app).get('/api/auth/google/callback').query({ code: 'the-code', state: google.searchParams.get('state') });
  expect(cb.status).toBe(302);
  const back = new URL(cb.headers.location!);
  return { app, google, googleFetch, back, params: new URLSearchParams(back.hash.slice(1)) };
}

const goodClaims = (nonce: string) => ({
  iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-42', email: 'gsbwine@gmail.com', email_verified: true, nonce,
});

describe('Google sign-in', () => {
  it('sends the user to Google with the callback URL, and back to the app signed in', async () => {
    const { app, google, googleFetch, back, params } = await signIn(goodClaims);
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(google.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(google.searchParams.get('redirect_uri')).toBe('https://api.example.com/api/auth/google/callback');
    expect(google.searchParams.get('scope')).toBe('openid email profile');

    const sent = new URLSearchParams(String(googleFetch.mock.calls[0]![1]?.body));
    expect(sent.get('code')).toBe('the-code');
    expect(sent.get('redirect_uri')).toBe('https://api.example.com/api/auth/google/callback');

    expect(back.protocol + back.host).toBe('winetracker:auth');
    expect(params.get('email')).toBe('gsbwine@gmail.com');
    const token = params.get('token')!;
    const me = await request(app).get('/api/tastings').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    const { rows } = await db.query('SELECT auth_sub, email FROM users');
    expect(rows).toEqual([{ auth_sub: 'google:g-42', email: 'gsbwine@gmail.com' }]);
  });

  it('signs the same Google account in as the same user', async () => {
    await signIn(goodClaims);
    await signIn(goodClaims, 'exp://192.168.1.5:8081/--/auth');
    expect((await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n).toBe(1);
  });

  it('rejects ID tokens for another client, a replayed nonce, or an unverified email', async () => {
    for (const bad of [
      (n: string) => ({ ...goodClaims(n), aud: 'someone-else' }),
      (n: string) => ({ ...goodClaims(n), nonce: `${n}x` }),
      (n: string) => ({ ...goodClaims(n), email_verified: false }),
    ]) {
      const { params } = await signIn(bad);
      expect(params.get('token')).toBeNull();
      expect(params.get('error')).toBeTruthy();
    }
    expect((await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n).toBe(0);
  });

  it('only returns to the app or listed browser origins', async () => {
    const app = appWith(vi.fn<typeof fetch>());
    for (const redirect of ['https://evil.example/cb', 'http://localhost:8081.evil.example/', 'javascript:alert(1)', '']) {
      expect((await request(app).get('/api/auth/google/start').query({ redirect })).status).toBe(400);
    }
    expect(isAllowedRedirect('http://localhost:8081/auth', [], ['http://localhost:8081'])).toBe(true);
    expect(isAllowedRedirect('exp://10.0.0.2:8081/--/auth', ['winetracker'], [])).toBe(false);
  });

  it('lets the web sign-in popup keep its link to the app window', async () => {
    const start = await request(appWith(vi.fn<typeof fetch>())).get('/api/auth/google/start').query({ redirect: 'http://localhost:8081/auth' });
    expect(start.status).toBe(302);
    expect(start.headers['cross-origin-opener-policy']).toBeUndefined();
  });

  it('refuses a tampered or missing state', async () => {
    const app = appWith(vi.fn<typeof fetch>());
    expect((await request(app).get('/api/auth/google/callback').query({ code: 'c', state: 'nope' })).status).toBe(400);
  });

  it('is listed in /api/health only when configured', async () => {
    expect((await request(appWith(vi.fn<typeof fetch>())).get('/api/health')).body.signIn).toEqual(['google']);
    const dev = createApp({ db, provider: new NullProvider(), fetcher, auth: { allowDev: true } });
    expect((await request(dev).get('/api/health')).body.signIn).toEqual(['dev']);
    expect((await request(dev).get('/api/auth/google/start').query({ redirect: 'winetracker://auth' })).status).toBe(404);
  });
});
