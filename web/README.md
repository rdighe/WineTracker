# Foodscape — the website (foodscape.wine)

The desk companion to the WineTracker iPhone app: the same account, API and design system, built for what a phone
does poorly. Vite + React + TypeScript, a static site that calls the API in the parent directory.

| Page | Path | Signed in? | What the web adds over the app |
|---|---|---|---|
| Home / Overview | `/` | either | Landing page with a live price dossier; signed in: cellar value, biggest movers, recent tastings, picks |
| Price explorer | `/prices`, `/wines/:id` | no | A wine's price dossier: market price and range, every vintage side by side (click to select), price over time with what you paid, every shop's offer (sortable, sold-out toggle), researched background |
| Wine lists | `/lists`, `/lists/:id` | yes | Drop a restaurant's PDF list before dinner: read in the browser (pdf.js, `src/lib/pdf.ts`, rows laid out like the app's), ranked for your palate with the markup on every bottle and glass; sort and filter; save. Lists saved in the app open here |
| Cellar / Tasted | `/cellar`, `/tasted` | yes | A ledger: sortable 40px-row table with a detail pane, cost vs worth now, filters, ↑/↓ browsing, bottle counts, CSV export |
| Saved | `/saved` | yes | Watch list with today's market prices |
| Palate report | `/palate` | yes | Ratings by grape, region, country, producer, style; rating against price paid; sweet-spot price band; tastings per month; a printable / copyable sommelier card |
| For you | `/discover` | yes | Every Find wines filter at once, a grid of picks, saved views (shared with the app) |
| Import & settings | `/settings` | yes | Vivino CSV drag and drop, full CSV export, theme, sign out |

Design: the WineTracker design system's tokens (`src/styles.css`, light and dark), its web density (40px table rows,
14px text, 232px sidebar, 400px detail pane, glass top bar), the app's icon set, and Georgia for the wordmark only.
Charts are small SVG components in `src/components/charts.tsx`.

## Run it

```bash
cd web
npm install
cp .env.example .env        # VITE_API_URL: the API (http://localhost:5050 by default)
npm run dev                 # http://localhost:5173
```

The API must list the site's origin in `ALLOWED_ORIGINS` (e.g. `http://localhost:5173`) for calls and for Google
sign-in to return to it. With a local API started with `ALLOW_DEV_AUTH=true`, `/sign-in` also offers a name-only sign-in.

`npm run build` typechecks and writes `dist/`. Deploying: `docs/DEPLOY.md`, "The website".

## Sign-in

The site sends the browser to the API's `/api/auth/google/start?redirect=<site>/auth`; the API runs Google sign-in
and returns to `/auth` with a session token in the address's fragment (`src/lib/session.ts`). The token is kept in
localStorage. It's the same account as the iPhone app.
