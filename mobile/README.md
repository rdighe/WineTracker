# WineTracker mobile app

Expo (SDK 57) + Expo Router app for the WineTracker API in the parent directory.

Screens: four tabs, plus a floating **+** beside the tab bar.

- **Home** (where the app opens): "WineTracker", then *What would you like to drink today?* ("tonight" from 5 pm) with
  quick answers and **Find a bottle** (`app/find.tsx`: occasion, what's on the table, a style; picks from your cellar
  first, `GET /api/cellar/picks`, then from shops near you). **Out and about?** opens wine-list and shelf picks
  (`app/picks.tsx`: photograph a list or a shelf, or upload a PDF). Then what's in your cellar, what's worth buying
  near you, and your saved lists (`app/lists.tsx`).
- **Cellar**: the bottles you own (and Saved), with cost, value now and change, across one cellar or all of them.
  **Racks** (`app/racks.tsx`) draws each rack as a grid in its wines' colors: tap a place to put a bottle there, move
  it or take it off. **Receipts** (`app/receipts.tsx`): photograph a receipt or upload an invoice PDF, check the lines,
  and the bottles go in at what they cost. **Share** (`app/cellars.tsx`): more cellars, invite a partner or a team by
  link (can change, or can only look), roles; invite links open `app/join.tsx`.
- **Discover**: picks from your ratings, filtered by Red / White / Sparkling / Dessert or best value; Refresh picks
  re-reads your ratings; Find wines searches by price range, style, region, tasting notes and food, and a search can
  be saved as a view.
- **Journal**: everything you've tasted.
- **+** offers Scan a label, Scan a lineup, Receipt or invoice, Wine list or shelf, Choose a photo, or Search or add by hand.
- Someone new starts at **Welcome** (`app/welcome.tsx`): import from Vivino, then a skippable 90-second taste quiz
  (styles, a quick answer for ten kinds of wine, budget) and their first picks; then the tour.
- Suggestions carry a **fit** (`components/FitBadge.tsx`): how likely you are to enjoy the wine, in steps of 5% with a
  band and a confidence. Never a predicted star rating, and never which model worked it out.
- **Community** (`app/community.tsx`, `app/share-note.tsx`): share a tasting as a note (how you liked it, whether it
  was ready, your words; never your stars), read others' on Home, a wine's page or the feed; like, reply, report,
  block. People show by a name they choose, never their email.
- **Your taste** (`app/taste.tsx`): your taste card from your ratings, editable (flavors, styles, price, things to
  avoid), shared by link with friends, who see how alike you are (`app/taste-card.tsx`).
- **Imports** in Welcome and Settings: CellarTracker (`components/CellarTrackerImport.tsx`: handle and password sent
  on once, never kept; or exported CSV files) and Vivino, each with how-to.
- Wine lists and shelves not saved stay under Lists › Recent for 14 days (Settings changes it).
- The avatar at the top right of each tab opens **Settings** (appearance, location, account, Vivino import, the taste
  quiz, Show the tour). The **tour** (`components/Tour.tsx`) points at Find a bottle, Out and about?, + and Cellar the first time
  Home opens.

The **wine page** has the market price, your bottles and tastings of it, price by vintage, where to buy, background,
a bookmark (adds it to Saved), and add to cellar / log a tasting.

## Run it

```bash
cd mobile
npm install
cp .env.example .env     # set EXPO_PUBLIC_API_URL to the API (your computer's LAN IP when using a phone)
npx expo start           # scan the QR code with Expo Go, or press w for web
```

Start the API from the repo root with `ALLOW_DEV_AUTH=true` (and `ALLOWED_ORIGINS=http://localhost:8081` for the web
build). The sign-in screen offers whatever the API supports: development sign-in (any name) when it runs with
`ALLOW_DEV_AUTH=true`, and Google when it has a Google OAuth client.

## Google sign-in

The API runs the Google sign-in (`src/auth/google.ts`; setup in `docs/DEPLOY.md`, step 4). The app opens
`/api/auth/google/start` in a browser window and gets a session token back on its own address: `exp://...` in Expo
Go, `winetracker://auth` in builds, `<origin>/auth` on the web (`src/app/auth.tsx` finishes the web popup). The token
is kept in the keychain (localStorage on web) and lasts 90 days.

## Label text on the phone (Apple Vision)

`modules/label-text` is a local Expo module that reads label text on the iPhone with Apple's Vision framework
(free, offline). The app sends that text with the photo, and the API identifies most labels from it without its
paid LLM read (see `src/scan/scan.ts` in the API). Native code isn't in Expo Go, so there the app simply skips this
step; it needs a real build (below). Android has no implementation yet and behaves like Expo Go.

## TestFlight

The EAS project is `@foodscape/winetracker` (`owner` and `extra.eas.projectId` in `app.json`). One command per build:

```bash
cd mobile
npx eas-cli@latest login                      # as a member of the foodscape account, or EXPO_TOKEN set to a foodscape robot token
npx eas-cli@latest build -p ios --profile production --auto-submit
```

Build numbers are kept by EAS (`appVersionSource: remote`) and go up by one each build. Builds up to 17 were
made under an earlier Expo account, so the count on this project started at 17; App Store Connect refuses a
number it has seen, so it must never go backwards (`eas build:version:get -p ios` shows it).

EAS builds in the cloud (no Mac needed), asks for your Apple ID once, and manages the signing certificates. With
`--auto-submit` it uploads the build to App Store Connect; it appears in TestFlight 10-15 minutes later. Add
yourself as an internal tester (App Store Connect -> your app -> TestFlight) and install it with the TestFlight app.

The app talks to one API, fixed when it's built: `EXPO_PUBLIC_API_URL` (`eas.json` for TestFlight builds, `mobile/.env`
for `npx expo start`; `.env` isn't uploaded to EAS), else `https://api.foodscape.wine`. It can't be changed in the app.
A phone can only reach `https://` addresses, so for testing against the API on your computer run a tunnel next to it:

```bash
cloudflared tunnel --url http://127.0.0.1:5050   # prints https://<random>.trycloudflare.com
```

and set that address as `EXPO_PUBLIC_API_URL` in `mobile/.env` (then `npx expo start -c`). The address changes each time the tunnel restarts. Anyone who has it
can use your API (and its development sign-in) while the tunnel runs, so stop it when you're done.

## Look and feel

The app follows the WineTracker for iPhone design system (https://claude.ai/artifact/U5K56pGs59EFkS96owz4Cy). Its
tokens live in `src/components/theme.tsx`; the shared parts are in `src/components/ui.tsx`.

- **Light** is the default; **Evening** (warm aubergine, never black) and **Match phone** are in Settings › Appearance.
- **Color is the wine:** a wine's style tints its tile and card (`c.wash`). Wine names are New York and numbers SF
  Rounded on Apple devices (`type.wineTitle`, `type.figure`).
- **Liquid glass** (tab bar, wine-page toolbar, buttons over photos) is `src/components/Glass.tsx`: native Liquid Glass
  on iOS 26 (`expo-glass-effect`), a blur elsewhere. It is always Tinted; Reduce Transparency makes it solid and
  Increase Contrast more frosted. `expo-glass-effect` is native code: make a new development or TestFlight build after
  pulling this.
- **Photos first:** a wine's page opens on its photo; rows lead with a thumbnail; For you is a grid of photo cards.
- **Type:** the Apple system font everywhere, with tabular figures for prices. The opening animation types
  "WineTracker" in white on black in Perfect DOS VGA 437, foodscape.wine's pixel face
  (`assets/fonts/PerfectDOSVGA437.ttf`, from foodscape.blog), then fades onto the app
  (`src/components/SplashIntro.tsx`). The native splash before it is plain black, with no image.
- **Motion** (Reanimated; all of it respects Reduce Motion): Log tasting, Add to cellar and Find wines open a sheet
  that grows out of the button (`ExpandingSheet.tsx`); the tab highlight and segmented controls slide; rows fade in,
  and slide gently (220 ms ease-out, no bounce) as a tasted row opens; buttons spring when pressed.

## Near you

Settings › Location (or "Shops near me" on For you and Where to buy): off, the phone's location (`expo-location`,
permission asked when turned on), or a state typed in. The location is rounded to about a kilometer and sent only as
`?near=lat,lng,ST` with the requests that use it; the server never stores it. For you then suggests only wines a shop
within 30 miles has, or a shop that ships to your state, and Where to buy lists those shops first, each marked
"6 mi away" or "Ships to you". Where none match, everything shows, with a note saying so.

## Scans in the background

Switching apps mid-scan loses nothing. Each scan gets an id (`ref`); the photo goes up through an iOS background
upload session (`expo-file-system`), so it finishes uploading while the app is away, and the server keeps the
answer under that id (`scan_jobs`). Back in the app - even after iOS closed it - Add wine asks
`GET /api/scans/jobs/:ref` and shows the result (`src/lib/pendingScan.ts`).

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

Builds go through EAS (see TestFlight above and https://docs.expo.dev/eas/).
