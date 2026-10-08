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
npm start                 # Expo Go (expo-dev-client is installed: use `npx expo start --tunnel --go` for a tunnel)
npm run typecheck         # app + tests
npm test                  # jest smoke tests: every route renders with a mocked Supabase
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
- `verify_jwt: true`. With a **user access token** only the server-built modes work: `{"notification_for":"<recipient uuid>"}` pushes the newest notification row the DB triggers wrote for that recipient with the caller as actor (message, match, like, comment, story reply…), and `{"event_notifications":"<event uuid>"}` pushes an event creator's update/cancel rows. Clients can't send free-form title/body text.
- The app calls it after sending a message, liking, commenting and so on (`lib/push.ts`), and after editing or cancelling an event (`lib/events.ts`).
- A device token belongs to whoever is signed in now. Sign-out deletes the row, and a DB trigger unlinks the token from any other account when it's registered again.

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

#### IAP / RevenueCat

- `apps/mobile/lib/iap.ts` wraps `react-native-purchases`. Keys: `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` (empty = paywall shows, purchases disabled, no crash). In **Expo Go** the SDK runs in *Preview API Mode* (simulated purchases).
- **Entitlements come only from the server**: `public.subscriptions`, written exclusively by the `revenuecat-webhook` Edge Function (service role). Clients have SELECT on their own rows only; `get_my_tier()` returns `free | match_plus | super_match`.
- DB-enforced perks (`supabase/migrations/20261008_premium_perks.sql`; errors are `P0001` codes such as `premium_required`, `daily_like_limit`, `super_like_limit`, `boost_quota`, `already_matched`):

  | Perk | Free | MATCH+ | SUPER MATCH | Server piece |
  |---|---|---|---|---|
  | Likes / 24h | 25 | ∞ | ∞ | `enforce_like_limits` trigger |
  | Super likes | 1 / 24h | 5 / day | ∞ | same trigger; `on_super_like_notify` → `notifications(type='super_like')` + push; `super_liked_me` pins them first in the recipient's deck |
  | Filters | distance + age | + verified, intention, 1 km / 1 yr precision | same | `get_discover_deck(...)` ignores advanced filters for free |
  | See who liked you | count | list | list | `get_likes_received()` |
  | Rewind | — | ✓ | ✓ | `rewind_last_swipe()` (last like/pass ≤ 24h, refuses if matched); passes stored in `public.passes` |
  | Why you match | teaser | 7 dims | 7 dims | client-side (`lib/compat.ts`) |
  | Boost 30 min | — | 1 / month | 1 / month | `boosts`, `activate_boost()`, `get_boost_status()`; boosted users ordered first |
  | Incognito | — | — | ✓ | `profiles.incognito` (trigger-gated) + profiles RLS + deck: only people you liked can see you |
  | Profile views | count | count | list | `record_profile_view()`, `get_profile_viewers_count()`, `get_profile_viewers()` |
  | Message priority | — | — | ✓ | `messages.is_priority` set by trigger on a SUPER MATCH user's first message; pinned + badged in Messages |

  Paywall copy (pt-PT / EN, plan lists + comparison): `apps/mobile/lib/plans.ts`.
- Setup steps: `docs/STORE_CHECKLIST.md`.

## What’s real vs stub (mobile)

| Area | Status |
|------|--------|
| Auth (email/password) + SecureStore session | **Real** |
| Onboarding (name/age/gender/city/intention/bio → `onboarding_complete`) | **Real** |
| Discover + likes → DB match trigger + overlay | **Real** (DEMO cards if deck empty) |
| Chat list / thread + realtime `messages` | **Real** |
| Feed posts, likes, comments | **Real** |
| Profile photo upload → Storage + `photos` | **Real** (needs device permissions) |
| Stories (photo / **video ≤30s** / text / question / poll, 24h) | **Real** |
| Events: create/edit/cancel/delete (cover → `event-covers`), filters, going/interested + counts, attendees | **Real** (`get_events` / `get_event_attendees` RPCs; capacity + blocks enforced by trigger; attendees notified + pushed on change/cancel) |
| Approximate location + map | **Real, opt-in** (`expo-location` → `set_my_location`; only a ~1.5 km grid cell stored in `private.user_locations`; map = jittered km offsets from `get_map_people` / `get_events`; Discover distance computed server-side; honours show distance / discoverable / incognito / blocks) |
| Push + in-app notification deep links | **Real** (message/match → chat, like/comment → `/post/[id]`, story reply/like → `/story/[id]` activity, event change → `/event/[id]`) |
| Story owner activity (viewers, likes, replies/answers, votes) + story-like notification | **Real** (`get_story_activity`, owner-only) |
| Chat read receipts (✓ sent / ✓✓ read) | **Real** (`mark_conversation_read`; `profiles.read_receipts` toggle off ⇒ `read_at` never written; unread from `conversation_reads`) |
| Friday answer (own profile edit + others' detail) | **Real** |
| Expired story media cleanup | **Real** (pg_cron `cleanup-story-media` hourly → Edge Function with runtime service key; cron auth = public anon JWT in Vault `match_cron_anon_key`, not in git) |
| Live | **Server-backed**: go live / end, heartbeat viewer counts, realtime room chat, reactions, LIVE MATCH votes (RLS, block-aware, rate limited). **Video via LiveKit** in dev/production builds (`livekit-token` Edge Function; needs LIVEKIT_* secrets); Expo Go shows a "video in the app build" state |
| Push permission + token → `push_tokens` | **Stub wired** (needs EAS projectId + APNs/FCM to deliver) |
| IAP / RevenueCat | **Wired** (needs RevenueCat + store accounts; Preview Mode in Expo Go) |
| EAS dev/preview/production config, icons, splash, permissions | **Ready** (submit IDs are placeholders) |
| In-app account deletion (`delete-account` Edge Function) | **Real** |
| 18+ age gate (onboarding + DB trigger) | **Real** |
| Privacy policy / Terms (PT/EN) | **Drafts — need legal review** (`docs/legal`, `/legal/*` screens) |
| Interests catalog + `user_interests` | **Real** (seeded; onboarding/profile multi-select; Discover chips) |
| Block / report | **Real** (Discover ⋯ → `blocks` / `reports`; deck excludes **either-way** via `get_blocked_peer_ids()`) |
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
