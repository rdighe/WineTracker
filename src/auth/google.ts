/**
 * Google sign-in (OpenID Connect authorization-code flow, run by the API so it
 * works the same in Expo Go, the web build and App Store builds).
 *
 * 1. The app opens GET /api/auth/google/start?redirect=<app URL> in a browser.
 * 2. The API sends the user to Google; Google returns to /api/auth/google/callback.
 * 3. The API exchanges the code for an ID token, signs the user in and
 *    redirects to the app URL with "#token=<session token>&email=<email>"
 *    (or "#error=<message>").
 *
 * App URLs are restricted to the configured custom schemes (winetracker://,
 * exp:// for Expo Go) and the browser origins in ALLOWED_ORIGINS, so a sign-in
 * link can't hand a session token to another site.
 */
import { Router, type Request, type Response } from 'express';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';
import { createSessionToken, type AuthUser } from './auth.js';

export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  /** Custom URL schemes the app may be sent back to, e.g. ["winetracker", "exp"]. */
  appSchemes: string[];
  /** Browser origins the web build runs on (ALLOWED_ORIGINS). */
  allowedOrigins: string[];
  /** The API's public base URL; defaults to the request's own (behind "trust proxy"). */
  publicUrl?: string;
  fetch?: typeof fetch;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const STATE_AUDIENCE = 'winetracker-google-state';

class SignInError extends Error {}

/** Is this an address the app may be sent back to? */
export function isAllowedRedirect(redirect: string, appSchemes: string[], allowedOrigins: string[]): boolean {
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return false;
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme === 'http' || scheme === 'https') return allowedOrigins.includes(url.origin);
  return appSchemes.includes(scheme);
}

export function googleRoutes(opts: GoogleOptions, userFor: (authSub: string, email: string) => Promise<AuthUser>): Router {
  const router = Router();
  const stateKey = new TextEncoder().encode(opts.sessionSecret);
  const doFetch = opts.fetch ?? fetch;
  const callbackUrl = (req: Request) =>
    `${(opts.publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/api/auth/google/callback`;

  // On the web the sign-in runs in a popup that reports back to the app window;
  // helmet's Cross-Origin-Opener-Policy would cut the popup off from it.
  router.use((_req, res, next) => {
    res.removeHeader('Cross-Origin-Opener-Policy');
    next();
  });

  const back = (res: Response, redirect: string, params: Record<string, string>) =>
    res.redirect(302, `${redirect.split('#')[0]}#${new URLSearchParams(params)}`);

  router.get('/start', async (req, res) => {
    const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : '';
    if (!isAllowedRedirect(redirect, opts.appSchemes, opts.allowedOrigins)) {
      return void res.status(400).json({ error: 'redirect is not an allowed app address' });
    }
    const nonce = randomBytes(16).toString('base64url');
    const state = await new SignJWT({ redirect, nonce })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(STATE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(stateKey);
    const params = new URLSearchParams({
      client_id: opts.clientId,
      redirect_uri: callbackUrl(req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'select_account',
    });
    res.redirect(302, `${AUTH_URL}?${params}`);
  });

  router.get('/callback', async (req, res) => {
    let redirect: string;
    let nonce: string;
    try {
      const { payload } = await jwtVerify(String(req.query.state ?? ''), stateKey, { audience: STATE_AUDIENCE });
      redirect = String(payload.redirect);
      nonce = String(payload.nonce);
    } catch {
      return void res.status(400).send('This sign-in link has expired. Go back to the app and try again.');
    }
    try {
      if (typeof req.query.error === 'string') throw new SignInError(req.query.error === 'access_denied' ? 'sign-in was cancelled' : req.query.error);
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code) throw new SignInError('Google returned no code');
      const tokenRes = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: callbackUrl(req),
          grant_type: 'authorization_code',
        }),
      });
      const body = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string };
      if (!tokenRes.ok || !body.id_token) throw new Error(`Google token exchange failed: ${body.error ?? tokenRes.status}`);
      // The ID token came straight from Google's token endpoint over TLS, which
      // OpenID Connect accepts in place of checking its signature (Core 3.1.3.7).
      const id = decodeJwt(body.id_token);
      if (!ISSUERS.has(String(id.iss)) || id.aud !== opts.clientId || id.nonce !== nonce) throw new Error('unexpected ID token');
      if (!id.sub || typeof id.email !== 'string' || id.email_verified !== true) throw new SignInError('this Google account has no verified email');
      const user = await userFor(`google:${id.sub}`, id.email);
      const token = await createSessionToken(opts.sessionSecret, user.authSub, id.email);
      back(res, redirect, { token, email: id.email });
    } catch (err) {
      if (!(err instanceof SignInError)) console.error('Google sign-in failed:', err);
      back(res, redirect, { error: err instanceof SignInError ? err.message : 'sign-in failed; try again' });
    }
  });

  return router;
}
