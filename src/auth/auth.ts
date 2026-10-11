/**
 * Request authentication.
 *
 * Production: "Authorization: Bearer <Supabase access token>", verified with
 * the project's JWT secret (HS256) or its JWKS (asymmetric signing keys).
 * Development (ALLOW_DEV_AUTH=true, never in production): "Authorization: Dev
 * <name>" acts as that user, so the API and app can be exercised without a
 * Supabase project.
 *
 * The first authenticated request creates the users row.
 */
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Db } from '../db/pool.js';

export interface AuthOptions {
  jwtSecret?: string;
  jwksUrl?: string;
  allowDev?: boolean;
}

export interface AuthUser {
  userId: number;
  authSub: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export class AuthError extends Error {}

export function createAuthenticator(db: Db, opts: AuthOptions) {
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : null;
  const jwks = opts.jwksUrl ? createRemoteJWKSet(new URL(opts.jwksUrl)) : null;

  async function verify(token: string): Promise<JWTPayload> {
    if (jwks) return (await jwtVerify(token, jwks)).payload;
    if (secret) return (await jwtVerify(token, secret, { algorithms: ['HS256'] })).payload;
    throw new AuthError('authentication is not configured');
  }

  async function userFor(authSub: string, email: string): Promise<AuthUser> {
    const { rows } = await db.query(
      `INSERT INTO users (auth_sub, email) VALUES ($1, $2)
       ON CONFLICT (auth_sub) DO UPDATE SET email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE users.email END
       RETURNING user_id`,
      [authSub, email]
    );
    return { userId: rows[0].user_id, authSub };
  }

  /** Resolve the request's user, or throw AuthError. */
  async function authenticate(header: string | undefined): Promise<AuthUser> {
    const [scheme, value] = (header ?? '').split(/\s+/, 2);
    if (opts.allowDev && scheme === 'Dev' && value && /^[\w.@-]{1,64}$/.test(value)) return userFor(`dev:${value}`, '');
    if (scheme !== 'Bearer' || !value) throw new AuthError('missing bearer token');
    let payload: JWTPayload;
    try {
      payload = await verify(value);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('invalid token');
    }
    if (!payload.sub) throw new AuthError('token has no subject');
    return userFor(payload.sub, typeof payload.email === 'string' ? payload.email : '');
  }

  /** Express middleware: 401 unless authenticated. */
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    authenticate(req.headers.authorization)
      .then((u) => {
        req.user = u;
        next();
      })
      .catch((err) => (err instanceof AuthError ? res.status(401).json({ error: err.message }) : next(err)));
  };

  /** Attach the user when a valid credential is present; never rejects. */
  const optionalUser = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.headers.authorization) return next();
    authenticate(req.headers.authorization)
      .then((u) => {
        req.user = u;
        next();
      })
      .catch(() => next());
  };

  return { authenticate, requireUser, optionalUser };
}
