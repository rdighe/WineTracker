# WineTracker — handoff for the next session

*Written 2026-10-12. Repo `rohanatstanford/WineTracker`, branch `claude/vigilant-galileo-9w14bw` (everything is pushed).*

---

## Part 1 — What YOU do (before and while starting the new chat)

### Once, in the Supabase dashboard
1. **Rotate the service-role key** (Project Settings → API Keys). It was pasted into a chat. WineTracker never uses it.
2. **Authentication → Emails → "Magic Link" template:** add `{{ .Token }}` somewhere in the body (e.g. `Your code: {{ .Token }}`).
   The app asks for a 6-digit code; the default template only has a link.
3. *(Before real users)* **Authentication → SMTP:** set up a custom SMTP sender. Supabase's built-in sender only allows a few emails per hour.

### Starting the new chat
4. Make sure the environment still has the **`GEMINI_API_KEY` network secret** with allowed host
   `generativelanguage.googleapis.com`. Secrets only reach sessions started *after* they were added, which is why the last session couldn't use it.
5. Start a **new Claude Code session on this repo**, on branch `claude/vigilant-galileo-9w14bw`.
6. **Attach these files** to your first message:
   - `winetracker-seed-2026-10-12-lwin.dump.part00` and `.part01` (the database, sent in the last chat)
   - **2–3 photos of real wine labels** (front label, straight on, readable), for the scan test
7. Paste the prompt in Part 2.

### Decisions only you can make (no rush)
- **Terms of service:** 5 crawled shops prohibit scraping (Zachys, Bassins, Chambers St, Primal, Mission Liquor).
  They're included because you asked. Before a public launch, decide whether to keep them
  (`EXCLUDE_TOS_PROHIBITED=true` drops them in the worker).
- **Hosting:** Render (Postgres, API and three cron jobs, `render.yaml`) with Supabase for sign-in only; steps in `docs/DEPLOY.md`.

---

## Part 2 — Prompt to paste into the new chat

> Read `docs/HANDOFF.md` on branch `claude/vigilant-galileo-9w14bw` and continue from "Part 3". I've attached the two
> database dump parts and some wine-label photos. First set up the local database from the dump, then test a label scan
> with my photos using Gemini, then work through the remaining tasks. Ask me before deploying anything or spending
> money beyond normal Gemini test calls.

---

## Part 3 — Context and instructions for Claude

### What exists
WineTracker = track wines you taste, the price then vs now, and get recommendations. See `README.md` (backend) and
`mobile/README.md` (Expo app).

- **Backend:** TypeScript/Node/Express/Postgres, in `src/`. Main parts:
  - catalog + fuzzy matcher (`src/match/`)
  - label scan via Gemini (`src/scan/`, `src/llm/gemini.ts`)
  - price crawling, aggregation and on-demand refresh (`src/prices/`)
  - Supabase JWT auth (`src/auth/`), tastings (`src/tastings/`), recommendations (`src/recs/`)
  - a background worker (`src/worker.ts`)
- **Tests:** 101 (vitest), all passing; `npm run eval:matcher` reports 0 wrong auto-matches on 46 labelled cases.
- **Mobile:** Expo SDK 57 + Expo Router, in `mobile/`. Typecheck and lint are clean. The web build was driven end to
  end with Playwright (sign-in, search, log tastings, recommendations).
- **Data (in the dump):**
  - 226k wines: 185.5k from LWIN (Liv-ex, CC licence) plus 40.5k created from shop listings
  - 131.6k shop listings matched to wines; 38.9k wines with a current market price
  - shops: 7 Shopify/WooCommerce feeds plus Wally's and Spec's (partly crawled; about 48k product pages still queued in `crawl_pages`)
- **Supabase:** project `https://bmtteqhttsadodgwodzn.supabase.co`.
  - It signs tokens with ES256, so the API verifies them with `SUPABASE_JWKS_URL=https://bmtteqhttsadodgwodzn.supabase.co/auth/v1/.well-known/jwks.json`
    (no secret needed).
  - Verified end to end: a real user token is accepted; the anon key, service key and tampered tokens are rejected.
  - The app needs the project's **anon key** in `mobile/.env` (it's public by design). Ask the user to paste it, or
    read it from the Supabase dashboard.

### Progress since this was written (2026-10-12, second session)
- **Gemini works** via the environment's network secret (header `x-goog-api-key`); set `GEMINI_API_KEY` to any
  placeholder so the provider is enabled. The key is free tier: label reads work, **search grounding returns 429**.
  The user chose not to enable billing for now, so `PRICE_WEB_SEARCH=false` (set in `render.yaml`): prices come from
  the crawl and from re-checking known shop pages only.
- **Label scan verified end to end** on 3 real photos (La Conseillante 2016, Denner Ditch Digger 2016, Tertre
  Roteboeuf 1999): correct reads, all `auto` to the right LWIN wine; confirm + tasting + paid-vs-market work.
- **Crawl:** one 3,000-page chunk each for Wally's and Spec's done; Spec's has ~1.6k pages left, Wally's ~40.8k.
- **Duplicates:** matcher fixes (main wine's appellation/classification is description, style phrases, rosé rule,
  tie-break) and a stricter `duplicates.ts auto-merge` (`--dry-run`, exact tokens, two-way check, vintage/NV words,
  keeps the LWIN wine). Three reviewed dry runs, then 278 merges applied locally (log in `data/review/`).
  Still open: typo duplicates ("Terte Roteboeuf") and pairs in `duplicates.ts export` need human review.
- Local DB only: none of this is deployed. Database is ~410 MB (check the Supabase plan limit before loading it).

### Step 1 — set up locally
```bash
# Postgres 16 is installed in the container; start it and create the role/dbs
pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE USER wt WITH PASSWORD 'wt' SUPERUSER;\" -c 'CREATE DATABASE winetracker OWNER wt;' -c 'CREATE DATABASE winetracker_test OWNER wt;'"
cat <uploaded part00> <uploaded part01> > /tmp/winetracker.dump
pg_restore --no-owner -d postgres://wt:wt@localhost:5432/winetracker /tmp/winetracker.dump
npm install && (cd mobile && npm install)
cp .env.example .env    # then set: ALLOW_DEV_AUTH=true, SUPABASE_JWKS_URL (above), ALLOWED_ORIGINS=http://localhost:8081
npm run migrate          # should report "up to date" (dump includes 001-006)
npm test
```
**Sandbox gotcha:** Node's built-in `fetch` ignores the HTTPS proxy unless you run with **`NODE_USE_ENV_PROXY=1`**
(needed for Gemini, the Supabase JWKS, and crawling). Without it, calls fail with `ENOTFOUND` or "invalid token".

### Step 2 — verify Gemini and test a label scan (the main goal)
1. Check that the secret reaches the session. A JSON list of models means it works; `injection failed ("Gemini")`
   means the secret isn't available in this session:
   `curl -sS "https://generativelanguage.googleapis.com/v1beta/models?pageSize=2" | head -c 300`.
2. How the key reaches the API:
   - If `GEMINI_API_KEY` is an env var, the code sends it in `x-goog-api-key` (`src/llm/gemini.ts`).
   - If it's a network secret injected by the proxy (no env var), work out how the proxy expects the request.
     Check `/root/.ccr/README.md` and `curl -sS "$HTTPS_PROXY/__agentproxy/status"`. You may need to set
     `GEMINI_API_KEY` to a placeholder, or drop the header, so the proxy can inject the real key.
     **Don't log the key.**
3. Start the API:
   `NODE_USE_ENV_PROXY=1 LLM_PROVIDER=gemini npx tsx src/server.ts` (run it in the background).
4. For each uploaded label photo:
   `curl -F "image=@photo.jpg;type=image/jpeg" -H "Authorization: Dev test" localhost:5050/api/scans`
5. Report what Gemini read, the match outcome (`auto` / `choose` / `new`), and whether the matched wine is right.
6. Then confirm a scan (`POST /api/scans/:id/confirm`) and log a tasting.
7. Try `POST /api/wines/:id/prices/refresh` on one wine, so the Gemini web search plus shop-page verification runs.
8. If reads or matches are off, fix them. Add the bad case to `test/fixtures/matcher-cases.ts`, and keep
   `npm run eval:matcher` at 0 wrong auto-matches.
9. Gemini models: `src/llm/gemini.ts` tries `GEMINI_MODEL`, then `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-3.5-flash` and
   `gemini-flash-latest` (Flash-Lite first: as accurate on real labels, cheaper; the 2.5 models are closed to new API keys). If those names are retired, list the available models and update the list.
10. Free alternative: `LLM_PROVIDER=openrouter` with `OPENROUTER_API_KEY` (`src/llm/openrouter.ts`) reads labels on OpenRouter's
   free vision models (`OPENROUTER_MODEL`, then `google/gemma-4-31b-it:free`, `nvidia/nemotron-3.5-super-vl:free`,
   `google/gemma-4-26b-a4b-it:free`, `openrouter/free`), moving to the next model when one is rate limited. No web price
   search on this provider. Free endpoints need "free endpoints that may train on inputs" allowed in the OpenRouter privacy
   settings, and allow about 50 requests a day (1,000 once the account has bought $10 of credits). Current free vision models:
   `curl -s https://openrouter.ai/api/v1/models` and keep ids ending in `:free` with `image` in `architecture.input_modalities`.

### Step 3 — remaining work, in priority order
1. **Mobile app on a real phone.** Not done yet: the app has only been tested on web.
   - Set `mobile/.env` (`EXPO_PUBLIC_API_URL`, Supabase URL and anon key), then `npx expo start`.
   - The user scans the QR code with Expo Go; the API must be reachable from the phone (a tunnel or deployed URL).
   - Test the camera scan and Supabase email-code sign-in.
2. **Deploy** (ask first): load the dump into Supabase Postgres (`DATABASE_URL` secret), then set up the Render
   services from `render.yaml`. Set the env vars listed in the README "Deploying" section.
3. **Finish the crawl:** Wally's/Spec's queues. Run `npm run crawl -- --site www.wallywine.com --site specsonline.com`;
   it resumes where it stopped. Background jobs are killed after 2 hours, so run it in chunks with `--max-pages`.
4. **Tasting-note tags per wine** (like Wine Circle's `wineResearch.js`): Gemini-researched descriptors, cached on
   the wine, used as suggested tags in the tasting form and as a recommendation feature.
5. **Duplicate cleanup:** ~5% of shop-created duplicates are wrongly merged or still split. The tools are
   `scripts/duplicates.ts` (export / auto-merge / apply) and `scripts/rematch.ts`. Review samples before trusting
   any auto-merge.
6. **Recommendations v2:** collaborative filtering once there are real users. Appellation→grape inference is
   already in `src/recs/features.ts`.

### Things to know
- **Don't commit scraped data or dumps.** `data/dumps`, `data/review`, `data/logs` and `data/screenshots` are
  git-ignored, and the repo is public.
- **The crawler** obeys robots.txt and Crawl-delay, uses an honest User-Agent, and never bypasses bot protection.
  wine.com, Total Wine, K&L and others block it; leave them out. Each site's terms status is in `src/prices/sites.ts`.
- **User-reported prices** (`source_type = 'user'`, e.g. a restaurant price paid) never move the market price.
- **Merges move tastings/saved wines** (`mergeWines`). Never delete wines by hand.
- **Background tasks are killed at 2 hours.** Long jobs must be resumable: `crawl.ts` and `merge-lwin.ts` are.
- **Kill dev servers by PID or port.** `pkill -f "src/server.ts"` also matches and kills the shell running it.
