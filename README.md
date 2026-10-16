# WineTracker

Track the wines you taste, what they cost then and now, and get recommendations.

- **Backend** (this directory): wine catalog with a fuzzy matcher, label scanning, US retail price tracking (bulk
  crawl + on-demand refresh), user tastings, and recommendations. TypeScript / Node / Express / Postgres.
- **Mobile app** (`mobile/`): Expo / React Native. See [mobile/README.md](mobile/README.md).

Builds on lessons from the GSB Wine Circle app (rule-based fallbacks whenever an LLM call fails, a model fallback list
for Gemini, strict matching because a wrong answer is worse than none, normalized tags).

## Layout

| Path | What it does |
|---|---|
| `src/lib/normalize.ts` | Text normalization shared by everything (accents, `Ch.`→`chateau`, stopwords, typo-tolerant token match) |
| `src/lib/listing.ts` | Parses a product title: vintage / `NV`, bottle size, pack size, "is this even wine" |
| `src/match/score.ts` | Pure scorer: does a catalog wine explain this query? producer, name, and "nothing unexplained" |
| `src/match/matcher.ts` | Trigram candidate search in Postgres + scorer → `auto` / `choose` / `new` |
| `src/catalog/` | Catalog writes, merges, LWIN row mapping |
| `src/llm/` | Provider-agnostic LLM interface (`readLabel`, `searchPrices`); Gemini implementation; `NullProvider` |
| `src/scan/scan.ts` | Label photo → vision read → matcher; confirming a scan teaches the matcher an alias |
| `src/prices/fetcher.ts` | Polite crawler HTTP: robots.txt + Crawl-delay, honest User-Agent, backs off and stops when refused |
| `src/prices/extract.ts` | schema.org Product/Offer from JSON-LD → microdata → Open Graph |
| `src/prices/shopify.ts`, `woocommerce.ts` | Catalog feeds (250 / 100 products per request) |
| `src/prices/ingest.ts` | Offer → listing → match/create wine → price observation |
| `src/prices/aggregate.ts` | Market price per wine+vintage: one vote per offer, MAD outlier filter, median/p10/p90, daily history |
| `src/prices/refresh.ts` | On-demand refresh: re-check known shop pages + LLM web search, verifying each hit on the shop's own page |
| `src/prices/sites.ts` | Retailers for the bulk crawl, with each site's terms-of-service status |
| `src/auth/auth.ts` | Supabase JWT verification (HS256 secret or JWKS); dev sign-in for local use |
| `src/tastings/tastings.ts` | Tasting log: rating, notes, tags, price paid (stored as a 'user' price observation) |
| `src/recs/` | Taste profile from ratings (grape, appellation, region, producer, style, price range) and recommendations |
| `src/api/app.ts` | REST API |

## Data model (short)

- `wines` – one row per wine (not per vintage); `lwin` when known; `source` = `lwin` / `crawl` / `user` / `llm`.
- `wine_aliases` – extra names learned from confirmed scans and merges.
- `merchants`, `listings` – one listing per shop product page/variant, matched to a wine once.
- `price_observations` – every price seen: per-pack price and per-750 ml price, vintage, stock, source, confidence.
  User-reported prices (`source_type = 'user'`, e.g. what you paid at a restaurant) are stored but never move the
  market price.
- `wine_prices` – current market price per wine + vintage (`'*'` = all vintages); `wine_price_daily` – history.

## Running locally

```bash
npm install
cp .env.example .env                     # set DATABASE_URL, GEMINI_API_KEY
npm run migrate
npm test                                 # needs TEST_DATABASE_URL (a separate, disposable database)
npm run dev                              # API on :5050 (not 5000: macOS AirPlay uses it)
```

Behind an HTTP proxy, Node's built-in fetch needs `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

### Catalog

```bash
npm run import:lwin -- ~/Downloads/LWINdatabase.xlsx
```

LWIN is free (Creative Commons) from https://www.liv-ex.com/lwin/ but sits behind a browser check, so download it by
hand. The import upserts by LWIN and then merges crawl-created wines that confidently match an LWIN wine.

### Prices

```bash
npm run crawl -- --max-pages 5000                 # all sites in src/prices/sites.ts
npm run crawl -- --site www.wallywine.com         # one site (sitemap crawls resume where they stopped)
npm run crawl -- --exclude-tos-prohibited         # skip sites whose terms forbid scraping
npm run aggregate                                 # recompute market prices for changed wines
```

The crawler obeys robots.txt and Crawl-delay, identifies itself as `CRAWLER_USER_AGENT`, and stops on a host that
keeps refusing it. It does not try to get past bot protection; wine.com, totalwine.com, klwines.com and others refuse
it and are not crawled.

**Terms of service.** Several crawled shops' terms forbid automated access or scraping (`tos: 'prohibits_scraping'`
in `src/prices/sites.ts`). They are included at the project owner's request. Before shipping publicly, decide per site
(or run with `--exclude-tos-prohibited`) and prefer affiliate/merchant feeds where possible.

### Data maintenance

```bash
npm run import:web-prices -- data/seed/web-prices.json  # offers found by web search (LLM or by hand)
tsx scripts/rematch.ts --changed-only "l.match_status = 'auto'"  # after a matcher fix: re-match listings that no longer fit
tsx scripts/backfill-tokens.ts --all                    # after changing normalization (stopwords etc.)
tsx scripts/duplicates.ts auto-merge                    # merge wines created twice under different shop titles
tsx scripts/duplicates.ts export                        # list uncertain duplicate pairs for review
```

### Seed database

The first crawl (2026-10-11) is not in the repo, because several sources' terms prohibit scraping and this repo is
public. It was delivered separately as a `pg_dump` file. To load it:

```bash
createdb winetracker
pg_restore --no-owner -d "$DATABASE_URL" winetracker-seed-2026-10-11.dump
```

It contains about 60k wines, 125k matched listings from 10 shops plus web-search finds, and current prices for about
38k wines. On hand-checked samples, wrong merges between wines run at roughly 5%. The usual misses are wines that
differ only in a region word ("DeLoach RRV Zinfandel" vs "DeLoach California Zinfandel").

### Reference photos

Each wine gets a product photo from the shop listings we crawl: the same wine and vintage if possible, else the
same wine, else another wine of the same producer and colour - and only a packshot on white (checked on the image:
light, neutral top corners and border, not landscape). Lookups run in the background when a wine is logged or its
page is opened. For a database crawled before images were recorded:

```bash
npm run images                          # re-read the shop feeds for image links, then pick photos for logged wines
npm run images -- --exclude-tos-prohibited
```

The photos are the shops' own product images, shown from their URLs. Check the shops' terms (and consider asking or
licensing) before a public launch.

### Background worker

```bash
npm run worker                     # feeds daily, product pages every 6 h, watched wines daily
npm run worker -- --once watched   # run one job now (feeds | pages | watched)
```

`watched` refreshes wines users saved or tasted in the last 90 days, stalest first, up to `REFRESH_PER_NIGHT`
(default 100). It uses the LLM web search, so each refresh costs roughly a cent with Gemini.

### Deploying

`render.yaml` defines the Render Postgres database, the API (web service) and three cron jobs that keep prices fresh
(`npm run worker -- --once feeds|pages|watched`); step-by-step instructions, including loading the data and copying
tastings from a local database (`npm run copy-user-data`), are in `docs/DEPLOY.md`. Sign-in uses Supabase Auth
(`SUPABASE_JWKS_URL`); label reading uses Gemini (`GEMINI_API_KEY`), or OpenRouter (`OPENROUTER_API_KEY`) when no Gemini key is set. Pending migrations are applied whenever
the API starts (`npm start` / `npm run dev`). `PRICE_WEB_SEARCH=false` limits price refreshes to re-checking known
shop pages. Paid endpoints are rate limited per user (30 scans and 30 price refreshes per hour by default).

## API

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/api/health` | | |
| POST | `/api/scans` | multipart `image` (jpeg/png/webp/heic, ≤ 8 MB) or JSON `{imageBase64, mimeType}`; optional `ocrText` | → `{scanId, read, outcome, vintage, bottleMl, candidates}`; with `ocrText` the wine is often identified without the LLM |
| POST | `/api/scans/:id/confirm` | `{wineId}` or `{newWine: {producer, name, region, …}}` | learns an alias |
| GET | `/api/wines/search?q=` | | ranked matches |
| POST | `/api/wines` | `{producer, name, …}` | user-created wine |
| GET | `/api/wines/:id` | | wine + price summaries per vintage |
| GET | `/api/wines/:id/prices?vintage=2019` | | summary, daily history, current offers |
| POST | `/api/wines/:id/prices/refresh` | `{vintage}` | on-demand refresh, throttled to once per 12 h per wine+vintage |
| POST | `/api/wines/:id/prices/report` | `{price, vintage, bottleMl, context: retail\|restaurant, merchant, observedAt}` | price at tasting |
| GET | `/api/me` | | signed-in user, counts (auth) |
| GET/POST | `/api/tastings` | `{wineId, vintage, rating (0.5–5), notes, tags, pricePaid, priceContext, tastedOn, scanId, kind: tasted\|cellar, bottles}` | auth; list includes paid vs market now and the wine's photo |
| PATCH/DELETE | `/api/tastings/:id` | partial tasting | auth, own tastings only |
| GET, PUT/DELETE | `/api/saved`, `/api/saved/:wineId` | | watch list (auth) |
| GET | `/api/recommendations?bestValue=&colour=&maxPrice=&limit=` | | auth; `{mode: 'locked', rated, needed}` until 3 ratings, then personal |
| POST | `/api/import/vivino` | `{csv}` (a Vivino data export, ≤ 8 MB) | auth; matches each row, adds unknown wines as the user's own; re-importing adds nothing |

Scan outcomes: `auto` (confident, attach directly), `choose` (show the candidates), `new` (offer to create the wine).
User routes need `Authorization: Bearer <Supabase access token>` (set `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL`).
For local development, `ALLOW_DEV_AUTH=true` also accepts `Authorization: Dev <name>`; it is ignored when
`NODE_ENV=production`. Browser origins (Expo web) must be listed in `ALLOWED_ORIGINS`.

## Matcher quality

```bash
npm run eval:matcher
```

Runs the labelled cases in `test/fixtures/matcher-cases.ts` and reports top-1 / top-3 accuracy, auto-match rate and
wrong auto-matches. Add a case whenever a real scan or listing is mismatched.
