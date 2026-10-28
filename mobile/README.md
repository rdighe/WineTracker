# WineTracker mobile app

Expo (SDK 57) + Expo Router app for the WineTracker API in the parent directory.

Screens: three tabs - **For you** (where the app opens: picks from your ratings, filtered by Red / White / Sparkling /
Dessert or best value; Refresh picks re-reads your ratings; Find wines searches by price range, style, region, tasting
notes and food, and a search can be saved as a view), **My wines** (Cellar, Tasted and Saved, switched at the top
right; a cellar or saved row opens the wine page, a tasted row opens in place) and **Settings** - plus a floating
**+** beside the tab bar that offers Scan a label, Scan a lineup, Choose a photo, or Search or add by hand, each
opening **Add wine** already started that way. The **wine page** has the market price, your bottles and tastings of
it, price by vintage, where to buy, background, a bookmark (adds it to Saved), and add to cellar / log a tasting.

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

A one-time setup, then one command per build. Needs a paid Apple Developer account and a free Expo account.

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                       # links the project to your Expo account (adds its id to app.json)
npx eas-cli@latest build -p ios --profile production --auto-submit
```

EAS builds in the cloud (no Mac needed), asks for your Apple ID once, and manages the signing certificates. With
`--auto-submit` it uploads the build to App Store Connect; it appears in TestFlight 10-15 minutes later. Add
yourself as an internal tester (App Store Connect -> your app -> TestFlight) and install it with the TestFlight app.

Production builds use the Render API (`EXPO_PUBLIC_API_URL` in `eas.json`; `mobile/.env` isn't uploaded to EAS).
It can be changed in the app (sign-in screen -> **Server**). An iPhone build can only reach `https://` addresses, so
for testing against the API on your computer run a tunnel next to it:

```bash
cloudflared tunnel --url http://127.0.0.1:5050   # prints https://<random>.trycloudflare.com
```

and enter that address under **Server**. The address changes each time the tunnel restarts. Anyone who has it
can use your API (and its development sign-in) while the tunnel runs, so stop it when you're done.

## Look and feel

The app follows the WineTracker design system (https://claude.ai/artifact/GYN2DuUbpCJ8eqerSf1U1F). Its tokens live
in `src/components/theme.tsx`; the shared parts are in `src/components/ui.tsx`.

- **Tabs:** Add wine, My wines (the cellar and tastings in one list; the Cellar / Tasted toggle switches them), For you,
  Settings (appearance, account, Vivino import, server).
- **Light and dark** follow the phone, or the Theme choice in Settings › Appearance.
- **Liquid glass** (tab bar, wine-page toolbar, buttons over photos) is `src/components/Glass.tsx`: native Liquid Glass
  on iOS 26 (`expo-glass-effect`), a blur elsewhere. It follows the phone's Liquid Glass (Clear/Tinted), Reduce
  Transparency and Increase Contrast settings; Reduce Transparency and Increase Contrast always win over the in-app
  Glass choice. `expo-glass-effect` is native code: make a new development or TestFlight build after pulling this.
- **Photos first:** a wine's page opens on its photo; rows lead with a thumbnail; For you is a grid of photo cards.
- **Type:** the Apple system font everywhere, with tabular figures for prices. The opening animation writes
  "WineTracker" in Georgia, a serif that ships with iOS (`src/components/SplashIntro.tsx`).
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
