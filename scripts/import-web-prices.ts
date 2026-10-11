/**
 * Import web-search price findings (gathered by an LLM or by hand) for wines
 * the crawl didn't cover.
 *
 *   npm run import:web-prices -- data/seed/web-prices.json
 *
 * File format: [{ "producer": "...", "name": "...", "region": "...", "colour": "red",
 *                 "vintage": "2021" | "NV" | null,
 *                 "hits": [{ "merchant", "url", "price": 59.99, "currency": "USD",
 *                            "vintage", "bottle_ml", "pack_size", "in_stock", "title" }] }]
 *
 * Each wine is matched to the catalog (or created with source 'llm'). Each hit
 * goes through the same path as an on-demand refresh: verified on the shop's
 * page when robots.txt allows, otherwise kept at confidence 0.5 only if the
 * title clearly matches.
 */
import { readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { createWine, getWine } from '../src/catalog/wines.js';
import { matchWine } from '../src/match/matcher.js';
import { sanitizePriceHits } from '../src/llm/sanitize.js';
import { aggregateWines } from '../src/prices/aggregate.js';
import { PoliteFetcher } from '../src/prices/fetcher.js';
import { applyWebHits } from '../src/prices/refresh.js';

interface Entry {
  producer: string;
  name?: string;
  region?: string;
  country?: string;
  colour?: string;
  grape?: string;
  vintage?: string | null;
  hits: unknown[];
}

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run import:web-prices -- file.json');
  process.exit(1);
}
const entries = JSON.parse(readFileSync(file, 'utf8')) as Entry[];
const db = createPool();
const fetcher = new PoliteFetcher({ userAgent: config.crawlerUserAgent, minDelayMs: 2000, timeoutMs: 20000 });

let created = 0, verified = 0, kept = 0, hitsTotal = 0;
const touched = new Set<number>();
for (const e of entries) {
  const text = [e.producer, e.name, e.region].filter(Boolean).join(' ');
  const m = await matchWine(db, { text, producer: e.producer, colour: e.colour });
  let wineId: number;
  if (m.outcome === 'auto') wineId = m.candidates[0]!.wine.wine_id;
  else {
    wineId = await createWine(db, { producer: e.producer, name: e.name ?? '', region: e.region, country: e.country, colour: e.colour, grape: e.grape, source: 'llm' });
    created++;
  }
  const wine = await getWine(db, wineId);
  const hits = sanitizePriceHits(e.hits);
  hitsTotal += hits.length;
  const r = await applyWebHits(db, fetcher, wine, e.vintage ?? null, hits);
  verified += r.verified;
  kept += r.unverifiedKept;
  touched.add(wineId);
  console.log(`${wine.display_name} ${e.vintage ?? ''}: ${hits.length} hits, ${r.verified} verified, ${r.unverifiedKept} kept unverified`);
}
await aggregateWines(db, [...touched]);
console.log(`done: ${entries.length} wines (${created} new), ${hitsTotal} hits, ${verified} verified, ${kept} unverified kept`);
await db.end();
