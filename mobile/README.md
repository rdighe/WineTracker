# WineTracker mobile app

Expo (SDK 57) + Expo Router app for the WineTracker API in the parent directory.

Screens: **Scan** (photograph a label → confirm the wine → log a tasting), **My wines** (ratings, what you paid,
market price now), **For you** (recommendations with reasons; best-value, red, white filters), **Search**, and a
**wine page** (market price by vintage, where to buy, refresh prices, save, log a tasting).

## Run it

```bash
cd mobile
npm install
cp .env.example .env     # set EXPO_PUBLIC_API_URL to the API (your computer's LAN IP when using a phone)
npx expo start           # scan the QR code with Expo Go, or press w for web
```

Start the API from the repo root with `ALLOW_DEV_AUTH=true` (and `ALLOWED_ORIGINS=http://localhost:8081` for the web
build). Without Supabase settings the app uses development sign-in: any name works.

## Sign-in with Supabase

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` here, and `SUPABASE_JWKS_URL`
(`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`) on the API. Users sign in with an emailed
one-time code; the app sends the Supabase access token to the API.

For the code to appear in the email, the Supabase **Magic Link** email template (Authentication → Emails) must
include `{{ .Token }}`. Supabase's built-in email sender is heavily rate limited; set up custom SMTP before launch.

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

The API address is set in the app (sign-in screen -> **Server**), not baked into the build. An iPhone build can
only reach `https://` addresses, so for testing against the API on your computer run a tunnel next to it:

```bash
cloudflared tunnel --url http://localhost:5000   # prints https://<random>.trycloudflare.com
```

and enter that address under **Server**. The address changes each time the tunnel restarts. Anyone who has it
can use your API (and its development sign-in) while the tunnel runs, so stop it when you're done.

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

Builds go through EAS (see TestFlight above and https://docs.expo.dev/eas/).
