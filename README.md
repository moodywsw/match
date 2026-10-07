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

### Expo Go / EAS

1. Install Expo Go → `npm start` → scan QR (same LAN or tunnel).
2. Store builds later: `eas login && eas init && eas build -p ios|android` (replace `extra.eas.projectId` in `app.json`).

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
| Push / IAP / verification selfie pipeline | **Not built** |

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
