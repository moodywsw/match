# Match

Dating / social app (taste & personality-first) backed by **Supabase**, with a native **Expo** client (primary) and a Vite web prototype.

## Supabase

- Project: **Match** · ref `pkpdheytmbwvqhpcaigm` · region `eu-west-1`
- API: `https://pkpdheytmbwvqhpcaigm.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/pkpdheytmbwvqhpcaigm
- Schema: [`schema.sql`](./schema.sql) (+ follow-up [`supabase/migrations/`](./supabase/migrations/))

### Storage

- Bucket **`profile-photos`** (public read). Upload path must be `{user_id}/{filename}`.
- Rows in `public.photos` store the public URL.

### Push tokens

- Table **`push_tokens`** (`user_id`, `token`, `platform`, unique per user+token). RLS: own rows only.

### Chat plumbing

- Match insert trigger creates `conversations` row.
- RPC `ensure_conversation(match_id)` for participants (idempotent).
- `messages` on `supabase_realtime` publication.

## Repo layout

```
apps/mobile/   Expo + Expo Router (primary product)
apps/web/      Vite React prototype
schema.sql     Base Postgres + RLS
supabase/migrations/  Follow-up DDL (chat trigger, storage, realtime)
```

## Mobile — run

```bash
cd apps/mobile
cp .env.example .env
# set EXPO_PUBLIC_SUPABASE_ANON_KEY from Dashboard → Settings → API
npm install
npm start                 # Expo Go
npm run typecheck
npx expo-doctor
```

Env (gitignored `.env`):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Root helpers: `npm run mobile` · `npm run web` · `npm run mobile:doctor`

### Expo Go (dev)

1. Install Expo Go → `cd apps/mobile && npm start` → scan QR (same LAN or tunnel).

### EAS Build & store submission (needs your accounts)

Nothing below invents credentials — you create them in Apple / Google / Expo dashboards.

#### One-time setup

1. **Expo account** — https://expo.dev/signup then:
   ```bash
   npm i -g eas-cli
   cd apps/mobile
   eas login
   eas init
   ```
   `eas init` writes a real UUID into the project. Put it in env (preferred) or it lands in `extra.eas.projectId` via `EAS_PROJECT_ID` / `EXPO_PUBLIC_EAS_PROJECT_ID` (see `app.config.ts`). Replace the placeholder `replace-after-eas-init`.

2. **Apple Developer Program** (paid) — https://developer.apple.com  
   - Create App ID / Bundle ID matching `com.match.app` (or change the id in `app.config.ts` first).  
   - In App Store Connect, create the app; note the numeric **Apple ID** → put in `eas.json` → `submit.production.ios.ascAppId`.  
   - For push: create an **APNs Key** (.p8) in Certificates, Identifiers & Profiles; upload it in Expo credentials (`eas credentials`) — do not commit `.p8` files.

3. **Google Play Console** — https://play.google.com/console  
   - Create the app with package `com.match.app` (or update `android.package`).  
   - For FCM: Firebase project → download `google-services.json`, keep it local, set `GOOGLE_SERVICES_JSON=./google-services.json` for builds (gitignored).  
   - For `eas submit`: create a Play service account JSON, store as `google-service-account.json` (gitignored); path is referenced in `eas.json`.

4. **Build profiles** (already in `apps/mobile/eas.json`):
   ```bash
   eas build --profile preview --platform android   # internal APK
   eas build --profile preview --platform ios       # TestFlight/ad-hoc via EAS
   eas build --profile production --platform all
   eas submit --profile production --platform ios
   eas submit --profile production --platform android
   ```

#### Push notifications

- Client: `lib/notifications.ts` requests permission and upserts into `public.push_tokens`.
- Delivery: Edge Function **`send-push`** (`supabase/functions/send-push`) looks up tokens and POSTs to the [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/) (no Expo account secret required for basic `ExponentPushToken[…]` sends).
- `verify_jwt: true` — call with a user access token (must be matched with `user_id`) or the **service role** JWT for trusted server/webhook paths.
- Chat already soft-invokes `send-push` after a successful message send.

**Test (user JWT — after two matched users have tokens):**

```bash
# In apps/mobile, sign in, grant notifications (needs real EAS projectId for a token).
# Then from a shell with the sender's access token:
curl -s -X POST \
  "https://pkpdheytmbwvqhpcaigm.supabase.co/functions/v1/send-push" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<matched_recipient_uuid>","title":"Test","body":"Hello from send-push"}'
```

**Test / production invoke (service role — never commit this key):**

```bash
# Prefer Dashboard → Edge Functions → send-push → Invoke, or CI secrets:
curl -s -X POST \
  "https://pkpdheytmbwvqhpcaigm.supabase.co/functions/v1/send-push" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<recipient_uuid>","title":"Match","body":"You have a new message"}'
```

Store the service role only in Supabase secrets / CI — never in the repo or client apps.

**DB trigger via `pg_net`:** extension is available on the project but not required. Prefer invoking from the app or a trusted worker until you enable `pg_net` and store the service role in Vault. See `supabase/migrations/20261007_send_push_notes.sql` for a template (not auto-armed).

#### IAP / RevenueCat (not enabled)

- Schema tables `subscriptions` / `payments` are **service-role / webhook only** — clients must never write them.  
- `apps/mobile/lib/iap.ts` is an empty stub (`configured: false`); it refuses purchase/restore.  
- When ready: create RevenueCat project + store products, install `react-native-purchases`, put SDK keys in **EAS Secrets**, webhook → Edge Function with service role. See comments in `lib/iap.ts`.

## What’s real vs stub (mobile)

| Area | Status |
|------|--------|
| Auth (email/password) + SecureStore session | **Real** |
| Onboarding (name/age/gender/city/intention/bio → `onboarding_complete`) | **Real** |
| Discover + likes → DB match trigger + overlay | **Real** (DEMO cards if deck empty) |
| Chat list / thread + realtime `messages` | **Real** |
| Feed posts, likes, comments | **Real** |
| Profile photo upload → Storage + `photos` | **Real** (needs device permissions) |
| Stories strip | **Read stub** (lists active `stories`) |
| Events list + RSVP | **Minimal real** (reads/writes tables; no admin create UI) |
| Live | **Metadata stub** (lists open `live_streams`; no A/V) |
| Push permission + token → `push_tokens` | **Stub wired** (needs EAS projectId + APNs/FCM to deliver) |
| IAP / RevenueCat | **Scaffold only** (`lib/iap.ts` — no purchases, no keys) |
| EAS preview/production config | **Scaffolded** (`eas.json` + `app.config.ts` placeholders) |
| Verification selfie pipeline | **Not built** |

## Core loop to exercise

1. Sign up two accounts → finish onboarding on both.
2. Upload a photo on Profile.
3. Discover → Like each other → match overlay.
4. Chat tab → open thread → send messages (second device sees realtime).
5. Feed → create post → like / comment.
6. Feed → Events / Live shortcuts (empty until data exists).

## Web prototype

```bash
cd apps/web && cp .env.example .env && npm install && npm run dev
```

Uses `VITE_SUPABASE_*`. Still useful as a reference UI; mobile is the App Store path.
