# Deploying to Render

What gets created from `render.yaml`:

| Piece | Render plan | Cost (Oct 2026, check render.com/pricing) |
|---|---|---|
| `winetracker-db`: Postgres 16 | 0.1 CPU / 256 MB, 5 GB disk | about $6 + $1.50 storage per month |
| `winetracker-api`: the API | Starter (0.5 CPU / 512 MB) | $7 per month |
| `winetracker-feeds`: cron job, daily 09:17 UTC | Starter, billed per minute it runs | together a few dollars per month |
| `winetracker-pages`: cron job, every 6 h | " | " |
| `winetracker-watched`: cron job, daily 11:23 UTC | " | " |

Sign-in stays on Supabase Auth (free plan); only the database moves to Render.

All the commands below run **on your Mac, from the `WineTracker` folder**. Your Render database URL contains its password:
keep it in your terminal, never paste it into a chat.

## 1. Get the code and the data

```sh
git pull
npm install
pg_restore --version     # must be 16 or newer
```

Put the three files `winetracker-prod-2026-10-16.dump.part00`, `part01` and `part02` in `data/dumps/`, then join them:

```sh
cd data/dumps
cat winetracker-prod-2026-10-16.dump.part* > winetracker-prod-2026-10-16.dump
shasum -a 256 winetracker-prod-2026-10-16.dump
# should print ec36891282b2832b6f976f726262284f86e4dc22f60b96d13389df787a09bfb6
cd ../..
```

The dump holds the wine catalog and all crawled prices (63,377 wines with a market price), with no user accounts or tastings in it.

## 2. Create everything on Render

1. Sign in at dashboard.render.com and connect your GitHub account if asked.
2. **New → Blueprint**, pick the `rdighe/WineTracker` repository and the branch that has `render.yaml`
   (`claude/compassionate-franklin-72h8wx` until it is merged into `main`).
3. Render lists the database and the four services. It asks for these values:
   - `GEMINI_API_KEY`: your Gemini key (label reading), from https://aistudio.google.com/apikey.
   - `OPENROUTER_API_KEY`: optional; used for label reading only if `GEMINI_API_KEY` is empty.
   - `ALLOWED_ORIGINS`: only needed for the web version of the app; enter `http://localhost:8081`.
4. **Apply.** Wait until the database says *Available* and `winetracker-api` says *Live* (5-10 minutes). Its first start
   creates the empty tables.

## 3. Load the data

1. In Render, open **winetracker-db → Connect → External** and copy the **External Database URL**.
2. In your Mac terminal (the quotes matter):
   ```sh
   export RENDER_DB='<paste the External Database URL here>'
   pg_restore --clean --if-exists --no-owner --no-privileges -d "$RENDER_DB" data/dumps/winetracker-prod-2026-10-16.dump
   ```
   This replaces the empty tables with the full catalog. It takes several minutes (it uploads about 70 MB and then
   builds the search indexes). It should finish without errors.
3. Check it:
   ```sh
   psql "$RENDER_DB" -c "SELECT COUNT(DISTINCT wine_id) FROM wine_prices"    # 63377
   ```
4. In Render, open **winetracker-api → Manual Deploy → Restart service**.
5. Open `https://<your api name>.onrender.com/api/health` in a browser: it should say `{"ok":true,...}`.

## 4. Point the app at Render and sign in

The production API only accepts real sign-ins (the "Dev" sign-in is turned off there).

1. In `mobile/.env`, set the Supabase values (Supabase dashboard → Project Settings → API):
   ```
   EXPO_PUBLIC_API_URL=https://<your api name>.onrender.com
   EXPO_PUBLIC_SUPABASE_URL=https://bmtteqhttsadodgwodzn.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<the anon / publishable key>
   ```
2. In Supabase, **Authentication → Emails → Magic Link** template: make sure the body contains `{{ .Token }}`
   (the app asks for the 6-digit code).
3. Restart Expo (`npx expo start -c` in `mobile`). In the app, open the Server card on the sign-in screen and check it
   shows the Render URL, then sign in with your email and the code you receive.

## 5. Copy your tastings from the Mac

Your tastings, cellar, saved wines and learned labels are in your Mac's local database. This copies them to your new
account on Render (sign in once first, step 4):

```sh
# See which local account is yours ("dev:<the name you signed in with>"):
npm run copy-user-data -- --from postgres://wt:wt@localhost:5432/winetracker --to "$RENDER_DB?sslmode=require" --to-email you@example.com
# Try it without writing anything:
npm run copy-user-data -- --from postgres://wt:wt@localhost:5432/winetracker --to "$RENDER_DB?sslmode=require" --to-email you@example.com --from-user dev:rohan --dry-run
# Then for real:
npm run copy-user-data -- --from postgres://wt:wt@localhost:5432/winetracker --to "$RENDER_DB?sslmode=require" --to-email you@example.com --from-user dev:rohan
```

Use your own local `DATABASE_URL` for `--from` if it differs, and the email you signed in with for `--to-email`.
Wines you added yourself on the Mac are matched by name, or created on Render. Running the command again copies nothing twice.
If it fails with a certificate error, use `?sslmode=no-verify` in place of `?sslmode=require`.

## 6. Lock the database down

The database accepts connections from anywhere (with its password) so you could load it. Afterwards, in Render, open
**winetracker-db → Networking** and remove the `0.0.0.0/0` entry, or replace it with your own IP. The API and the
cron jobs connect over Render's private network and don't need it.

## Afterwards

- Prices update on their own: the cron jobs' logs are in Render under each job. **Trigger Run** starts one now.
- Pushing to the deployed branch redeploys the API; new migrations run when it starts.
- Your Mac's local database keeps working for development (`npm run dev`, Dev sign-in).
- If search feels slow, upgrade the database plan in place (Render → winetracker-db → Change plan).
