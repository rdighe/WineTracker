import 'dotenv/config';

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://wt:wt@localhost:5432/winetracker',
  // Not 5000: macOS AirPlay Receiver listens there and answers 403.
  port: Number(process.env.PORT ?? 5050),
  // gemini | openrouter | none; unset = whichever has a key (Gemini first).
  llmProvider: (process.env.LLM_PROVIDER ?? '') as '' | 'gemini' | 'openrouter' | 'none',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterModel: process.env.OPENROUTER_MODEL ?? '',
  // Price refreshes also ask the LLM to search the web (Gemini: needs a
  // billed key for search grounding). false = re-check known shop pages only.
  priceWebSearch: process.env.PRICE_WEB_SEARCH !== 'false',
  // Auth: Supabase-issued JWTs. Either the project's JWT secret (HS256) or
  // its JWKS URL (asymmetric keys, https://<project>.supabase.co/auth/v1/.well-known/jwks.json).
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL ?? '',
  // Development only: accept "Authorization: Dev <name>" as that user.
  // Ignored when NODE_ENV=production.
  allowDevAuth: process.env.ALLOW_DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production',
  // Browser origins allowed to call the API (comma-separated). Native apps
  // don't need this; it's for the Expo web build and local development.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  crawlerUserAgent:
    process.env.CRAWLER_USER_AGENT ??
    'WineTrackerBot/0.1 (+https://github.com/rdighe/WineTracker)',
};
