import { config } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './api/app.js';
import { createProvider } from './llm/index.js';
import { PoliteFetcher } from './prices/fetcher.js';
import { warmRecommendations } from './recs/recommend.js';

const db = createPool();
const provider = createProvider();
// On-demand refreshes serve a waiting user, so use a shorter per-host delay
// than the bulk crawler - still serialized per host and robots-aware.
const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 1000, timeoutMs: 12000 });

createApp({
  db,
  provider,
  fetcher,
  auth: { sessionSecret: config.authSessionSecret, allowDev: config.allowDevAuth },
  google:
    config.googleClientId && config.googleClientSecret
      ? { clientId: config.googleClientId, clientSecret: config.googleClientSecret, appSchemes: config.authAppSchemes, publicUrl: config.publicUrl }
      : undefined,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
}).listen(config.port, () => {
  console.log(`WineTracker API on :${config.port} (LLM provider: ${provider.name})`);
  // For you's candidate list takes a few seconds to build; do it now rather than on someone's first visit.
  const t0 = Date.now();
  warmRecommendations(db).then(
    () => console.log(`Recommendations ready in ${Date.now() - t0} ms`),
    (e) => console.error('Recommendations warm-up failed:', e)
  );
});
