import { config } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './api/app.js';
import { createProvider } from './llm/index.js';
import { PoliteFetcher } from './prices/fetcher.js';

const db = createPool();
const provider = createProvider();
// On-demand refreshes serve a waiting user, so use a shorter per-host delay
// than the bulk crawler - still serialized per host and robots-aware.
const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 1000, timeoutMs: 12000 });

createApp({
  db,
  provider,
  fetcher,
  auth: { jwtSecret: config.supabaseJwtSecret, jwksUrl: config.supabaseJwksUrl, allowDev: config.allowDevAuth },
}).listen(config.port, () => {
  console.log(`WineTracker API on :${config.port} (LLM provider: ${provider.name})`);
});
