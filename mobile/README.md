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

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

Builds for the stores go through EAS: `npx eas-cli@latest build` (see https://docs.expo.dev/eas/).
