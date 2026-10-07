# Match

Dating / social app (taste & personality-first) backed by **Supabase**, with a native **Expo** client (primary) and a Vite web prototype.

## Supabase

- Project: **Match**
- Ref: `pkpdheytmbwvqhpcaigm`
- Region: `eu-west-1`
- API URL: `https://pkpdheytmbwvqhpcaigm.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/pkpdheytmbwvqhpcaigm
- Schema: [`schema.sql`](./schema.sql) (RLS enabled; already applied on the live project)

## Repo layout

```
apps/mobile/   Expo (React Native) + Expo Router — primary app
apps/web/      Vite + React prototype (auth / discovery already wired)
schema.sql     Postgres schema + RLS
```

## Mobile (Expo) — recommended

```bash
cd apps/mobile
cp .env.example .env
# set EXPO_PUBLIC_SUPABASE_ANON_KEY (Dashboard → Settings → API)
npm install
npm start          # Expo Go QR code
# or: npm run ios / npm run android / npm run web
npx expo-doctor    # sanity check
```

Env vars (never commit real keys — `.env` is gitignored):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (legacy anon JWT or `sb_publishable_…`)

### What’s wired (mobile)

- Supabase JS client with **SecureStore** session persistence (localStorage on web)
- Email/password **sign-up / sign-in**
- Auth gate → tabs: **Discover**, **Feed**, **Chat**, **Profile**
- Profile bootstrap: upserts `public.profiles` on first login; Profile tab can save name/city/bio

Still placeholders: Discover cards, Feed, Chat (real-time later).

### Expo Go

1. Install **Expo Go** on your phone.
2. `npm start` in `apps/mobile` and scan the QR code (same LAN, or use tunnel if needed).

### EAS Build (App Store / Play Store later)

When you’re ready for store builds (no Mac required for iOS cloud builds):

```bash
npm i -g eas-cli
cd apps/mobile
eas login
eas init          # replaces extra.eas.projectId in app.json
eas build -p ios
eas build -p android
```

See [Expo EAS Build](https://docs.expo.dev/build/introduction/).

## Web prototype

```bash
cd apps/web
cp .env.example .env
npm install
npm run dev
```

Uses `VITE_SUPABASE_*` env vars. Auth, profile, discovery, and likes are already connected.

## From repo root

```bash
npm run mobile       # Expo start
npm run web          # Vite dev
npm run mobile:doctor
```
