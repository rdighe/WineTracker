/**
 * Sign in with Apple (iOS). The app signs in natively (expo-apple-authentication)
 * and posts Apple's identity token to POST /api/auth/apple; the API checks the
 * token's signature against Apple's keys and that it was issued to this app,
 * then answers with a WineTracker session token: {token, email}.
 *
 * Apple shares the email only when the token says so (a private relay address
 * if the user chose to hide theirs); without one the account has no email.
 */
import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { createSessionToken, type AuthUser } from './auth.js';

export interface AppleOptions {
  /** Bundle IDs the identity token may be issued to (its audience), e.g. the app's own. */
  bundleIds: string[];
  sessionSecret: string;
  /** Apple's signing keys (tests pass their own). */
  keys?: JWTVerifyGetKey;
}

const ISSUER = 'https://appleid.apple.com';
const body = z.object({ identityToken: z.string().min(1).max(8000) });

export function appleRoutes(opts: AppleOptions, userFor: (authSub: string, email: string) => Promise<AuthUser>): Router {
  const router = Router();
  const keys = opts.keys ?? createRemoteJWKSet(new URL(`${ISSUER}/auth/keys`));

  router.post('/', async (req, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'identityToken is required' });
    let sub: string;
    let email: string;
    try {
      const { payload } = await jwtVerify(parsed.data.identityToken, keys, { issuer: ISSUER, audience: opts.bundleIds });
      if (!payload.sub) throw new Error('no subject');
      sub = payload.sub;
      email = typeof payload.email === 'string' ? payload.email : '';
    } catch {
      return void res.status(401).json({ error: 'Apple sign-in could not be verified; try again' });
    }
    const user = await userFor(`apple:${sub}`, email);
    res.json({ token: await createSessionToken(opts.sessionSecret, user.authSub, email), email });
  });

  return router;
}
