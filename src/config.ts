import 'dotenv/config';

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://wt:wt@localhost:5432/winetracker',
  port: Number(process.env.PORT ?? 5000),
  llmProvider: (process.env.LLM_PROVIDER ?? 'gemini') as 'gemini' | 'none',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? '',
  // Auth: Supabase-issued JWTs. Either the project's JWT secret (HS256) or
  // its JWKS URL (asymmetric keys, https://<project>.supabase.co/auth/v1/.well-known/jwks.json).
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL ?? '',
  // Development only: accept "Authorization: Dev <name>" as that user.
  // Ignored when NODE_ENV=production.
  allowDevAuth: process.env.ALLOW_DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production',
  crawlerUserAgent:
    process.env.CRAWLER_USER_AGENT ??
    'WineTrackerBot/0.1 (+https://github.com/rohanatstanford/WineTracker)',
};
