# MATCH — Store release checklist

Everything that does **not** need a store account is already done in the repo.
This list is what still needs the owner's accounts, secrets, or decisions.
Tick items as you go.

Project facts: Expo SDK 57 · EAS project `ec207fec-1ece-43a1-b5ef-d4383bc933f3` (owner `moidys-team`) ·
bundle id / package `com.moidy.match` · Supabase project `pkpdheytmbwvqhpcaigm`.

---

## 0. Decide the identifiers (before anything else)

- [x] Identifier: `com.moidy.match` (changed from the generic `com.match.app` before any store
      upload). It is set as `ios.bundleIdentifier` and `android.package` in
      `apps/mobile/app.config.ts`. **It can't be changed after the first store upload.** The
      URL scheme stays `match://`.
- [ ] Final app name. `Match` is almost certainly taken on the App Store, so pick something
      like "MATCH — Dating & Events".
- [ ] Legal entity (company name, NIF, address). It goes into the privacy policy, the terms,
      and the store listings.

## 1. Apple (App Store)

- [ ] Enrol in the Apple Developer Program (99 USD/yr). Use an organisation account if you
      want the company name shown as the seller; that needs a D-U-N-S number.
- [ ] App Store Connect → My Apps → **+ New App**: platform iOS, bundle id from step 0,
      SKU `match-ios`.
- [ ] Copy the **Apple ID** (a number) of the new app into `apps/mobile/eas.json` →
      `submit.production.ios.ascAppId`.
- [ ] Agreements, Tax and Banking: accept the **Paid Apps** agreement. Subscriptions can't be
      sold until it is active.
- [ ] Subscriptions: create a subscription group `MATCH` containing:
  - `match_plus_monthly`: 1 month, €14.99 (tier price)
  - `super_match_monthly`: 1 month, €24.99
  - Put SUPER MATCH at a higher level than MATCH+ in the group, so moving between them
    counts as an upgrade or downgrade.
  - Subscription localizations (display name / description, ≤ 55 chars) — see
    "Subscription copy" below. Product ids and prices are unchanged by the perk set.
- [ ] App Store Server Notifications V2 → set the URL that RevenueCat gives you (step 3).
- [ ] App Privacy questionnaire: declare email, name, photos, user content (messages, video,
      audio), coarse location, purchase history, identifiers (push token), sensitive info
      (orientation). All are linked to the user, none are used for tracking.
- [ ] Age rating: 18+ (frequent or intense mature themes, user-generated content, dating).
- [ ] Review notes: give the reviewer a **demo account** with a completed profile, and say
      where account deletion is (Profile → Settings & privacy → Delete account).

## 2. Google Play

- [ ] Create a Google Play Console developer account (25 USD one-time). Personal accounts
      must run a closed test (12 testers for 14 days) before production.
- [ ] Create the app with the package name from step 0.
- [ ] Google Cloud → service account with Play Console access → download the JSON as
      `apps/mobile/google-service-account.json`. It is git-ignored; EAS submit uses it.
- [ ] Monetise → Subscriptions:
  - `match_plus_monthly`, base plan `monthly` at €14.99
  - `super_match_monthly`, base plan `monthly` at €24.99
- [ ] Real-time developer notifications → the Pub/Sub topic from the RevenueCat setup.
- [ ] Data safety form: same data categories as the Apple questionnaire.
- [ ] Data deletion: in-app deletion is available. Google also requires a **web URL** where
      users can request deletion; host a simple page or form, for example on the
      privacy-policy site.
- [ ] Content rating questionnaire (dating, user-generated content) and target audience
      18+ only.
- [ ] FCM for push (Android). See "Adding Firebase (FCM) later" in section 6b.

- [ ] Subscription localizations (pt-PT + English): same display names and descriptions as
      in "Subscription copy" below; list the benefits in the base plan description.

## Subscription copy (must match the in-app paywall)

The paywall copy lives in `apps/mobile/lib/plans.ts` (pt-PT / EN). Store descriptions must
not promise anything the app doesn't deliver (App Review 3.1.2 / Play subscriptions policy).
There is **no "unlimited messages" perk** — messaging is free for every match. Boosts and
super likes are included in the subscriptions; there are **no consumable products**.

| | Free | MATCH+ (`match_plus_monthly`) | SUPER MATCH (`super_match_monthly`) |
|---|---|---|---|
| Likes | 25 / 24h | Unlimited | Unlimited |
| Super likes (recipient notified + highlighted) | 1 / 24h | 5 / day | Unlimited |
| Filters | Basic (distance, age) | + verified only, intention, exact age & distance | same as MATCH+ |
| See who liked you | — | ✓ | ✓ |
| Rewind last swipe (if no match formed) | — | ✓ | ✓ |
| "Why you match" | Teaser (2 of 7 + 1 reason) | All 7 dimensions | All 7 dimensions |
| Boost (30 min at top of Discover) | — | 1 / month | 1 / month |
| Incognito (only people you liked see you) | — | — | ✓ |
| See who viewed your profile | count only | count only | ✓ list |
| Message priority (first message pinned + badge) | — | — | ✓ |

All of the above is enforced server-side (`supabase/migrations/20261008_premium_perks.sql`)
except the "why you match" teaser, which is computed on the device.

| Product | Display name | Description EN (≤ 55) | Descrição pt-PT (≤ 55) |
|---|---|---|---|
| `match_plus_monthly` | MATCH+ | Unlimited likes, see who liked you, rewind & boost | Likes ilimitados, vê quem gostou de ti, rewind e boost |
| `super_match_monthly` | SUPER MATCH | Incognito, who viewed you, unlimited super likes | Incógnito, quem te visitou e super likes ilimitados |

## 3. RevenueCat

- [ ] Create the RevenueCat project "MATCH" and add the iOS app with bundle id `com.moidy.match`
      (App Store Connect API key + in-app purchase key) and the Android app with package
      `com.moidy.match` (service-account JSON). RevenueCat apps are tied to these identifiers.
- [ ] Products: import the 4 store products from steps 1 and 2.
- [ ] **Entitlements**: the ids must be exactly the following, because the DB and the
      webhook depend on them:
  - `match_plus` → attach `match_plus_monthly` (iOS + Android) **and** `super_match_monthly`
  - `super_match` → attach `super_match_monthly`
- [ ] Offering `default` (current) with two packages: custom ids `match_plus` and
      `super_match`, or `$rc_monthly` plus a second custom package. The app matches packages
      by "plus" or "super" in the product or package id.
- [ ] API keys → put the public SDK keys into EAS environment variables (they are public
      but per-environment):
  ```bash
  cd apps/mobile
  eas env:create --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value appl_xxx --environment production --environment preview --environment development --visibility plaintext
  eas env:create --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_xxx --environment production --environment preview --environment development --visibility plaintext
  ```
  For local runs or Expo Go, paste them into `apps/mobile/.env` (git-ignored).
- [ ] **Webhook** (Project settings → Integrations → Webhooks):
  - URL: `https://pkpdheytmbwvqhpcaigm.supabase.co/functions/v1/revenuecat-webhook`
  - Authorization header value: generate a long random string, e.g. `openssl rand -hex 32`
  - Environment: both (sandbox events are stored with `environment = 'SANDBOX'`)
- [ ] Put the same secret into Supabase. Until this is done the function rejects every call
      with 503:
  ```bash
  supabase secrets set REVENUECAT_WEBHOOK_SECRET=<the value above> --project-ref pkpdheytmbwvqhpcaigm
  # optional: lets TRANSFER events (restore on another account) re-sync from RevenueCat
  supabase secrets set REVENUECAT_SECRET_API_KEY=sk_xxx --project-ref pkpdheytmbwvqhpcaigm
  ```
- [ ] Send a **Test event** from the RevenueCat dashboard. Expect HTTP 200 `{ ok: true, test: true }`.
- [ ] Make a sandbox purchase on a dev build. A row should appear in `public.subscriptions`,
      and the app should unlock within a few seconds (realtime + polling).
- [ ] Optional: when an account is deleted, also delete the RevenueCat customer
      (`DELETE /v1/subscribers/{uid}` with the secret key). This isn't wired up; it could be
      added to `delete-account` once `REVENUECAT_SECRET_API_KEY` exists.

## 4. Supabase (before launch)

- [ ] Auth → Password security → enable **leaked password protection** (HaveIBeenPwned).
      It's a dashboard-only toggle and the only remaining Security Advisor warning. See
      `docs/SECURITY.md`.
- [ ] Make your account an admin so you can work the report queue:
      `update public.profiles set is_admin = true where id = '<your user id>';`
- [ ] Auth → set the email templates and the redirect URLs (`match://`).
- [ ] Check the project region (EU recommended for GDPR) and update the privacy policy to
      match.
- [ ] Re-run Security Advisors. Once leaked password protection is on, there should be zero
      findings.
- [ ] Optional: upgrade the plan for daily backups or PITR. The privacy policy promises a
      backup retention window.

## 4b. LiveKit (real video in Live rooms)

Live rooms already work without LiveKit. Rooms, viewers, chat, reactions and LIVE MATCH votes
all run on Supabase. Video needs LiveKit and a development or production build, because
Expo Go can't load the WebRTC native modules. In Expo Go the room shows "Video live is
available in the app build".

- [ ] Create a LiveKit Cloud project at https://cloud.livekit.io (or self-host LiveKit). The
      free tier is fine for testing. Under Settings → Keys, create an API key and secret.
- [ ] Set the Edge Function secrets. Never commit these values:
      ```bash
      supabase secrets set --project-ref pkpdheytmbwvqhpcaigm \
        LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_URL=wss://<project>.livekit.cloud
      ```
      You can also set them in the Dashboard under Edge Functions → Secrets. Until all three
      exist, `livekit-token` returns `503 livekit_not_configured` and the app shows "Video is
      being set up".
- [ ] Build a dev client with the native modules (`@livekit/react-native-expo-plugin` and
      `@config-plugins/react-native-webrtc` are already in `app.config.ts`):
      `eas build -p ios --profile development-device` and `eas build -p android --profile development`.
- [ ] Test on two physical devices. Device A goes live (camera and mic permission prompts).
      Device B opens the room and should see video. A blocked user must not see the room at
      all.
- [ ] Optional: in the LiveKit dashboard, add a webhook for room analytics or recording. The
      app doesn't depend on one.
- [ ] Store review notes: mention that live video uses the camera and microphone only while
      the user is live (the permission strings are already set).

How it works: `public.get_live_token_grant(stream_id)` checks that the stream is active and
that the caller isn't blocked either way. The host and the LIVE MATCH guest get
`canPublish`; viewers subscribe only. The Edge Function signs a 2-hour HS256 LiveKit token
for room `match-live-<stream_id>`.

## 5. Legal

- [ ] Have a lawyer review `docs/legal/*.md`, which are PT and EN drafts. The in-app copy is
      generated from `scripts/gen-legal.py`: edit there, then run
      `python3 scripts/gen-legal.py`.
- [ ] Fill in every `[bracket]` placeholder: company, NIF, address, emails, retention
      periods, provider regions.
- [ ] Host the policies at a public URL, e.g. GitHub Pages or a simple site (see below).
      Both stores need a privacy-policy URL, and Apple needs a Terms (EULA) link on the
      subscription listing.

## 6. Builds and submission (EAS)

`expo-dev-client` is already installed (LiveKit needs a development build). With it installed,
plain `npx expo start` serves the **development build** by default. To keep using Expo Go, start
Metro with `--go`, e.g. `npx expo start --tunnel --go`. Pressing `s` in the Metro terminal also
switches between the two modes.

```bash
cd apps/mobile
npm i -g eas-cli && eas login
eas whoami                                # must have access to moidys-team

# Development build (real RevenueCat sandbox purchases, real push)
eas build -p ios --profile development          # simulator
eas build -p ios --profile development-device   # physical iPhone (register device: eas device:create)
eas build -p android --profile development

# Internal testing
eas build -p android --profile preview          # installable APK
eas build -p ios --profile preview              # ad-hoc / TestFlight-internal

# Store builds
eas build -p ios --profile production
eas build -p android --profile production       # .aab
eas submit -p ios --profile production --latest
eas submit -p android --profile production --latest   # goes to the internal track as a draft
```

`appVersionSource: remote` combined with `autoIncrement` means EAS manages the build
numbers. Bump `version` in `app.config.ts` for each store release.

## 6b. Android sideload build + OTA updates (EAS Update)

**What is set up**
- `expo-updates` is installed, and `updates.url` points to `https://u.expo.dev/<projectId>`.
- Each build profile has its own channel in `eas.json`: `development`, `preview`, `production`.
- `runtimeVersion: { policy: 'fingerprint' }`. The runtime is a hash of the native layer:
  native dependencies, config plugins and native config. An OTA update only goes to installs
  whose native code it matches.
  - We chose this over `appVersion` because it fails safe. With `appVersion`, adding a native
    module without bumping `version` would ship JS to installs that lack the module, and the app
    would crash. With `fingerprint`, the worst case is that an update isn't offered to an old
    install and you need a new build.
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are EAS environment variables
  for development, preview and production (`eas env:list --environment preview`). They are public
  values; the service_role key is **never** stored there or in the app.
- Android signing: EAS generated and stores the keystore (`eas credentials -p android` to view or
  back it up). Keep that keystore: Play updates must be signed with the same key, or you use
  Play App Signing.

**Build and install the APK (no Play Store, no dev server)**
```bash
cd apps/mobile
npx eas-cli build -p android --profile preview --non-interactive --no-wait
npx eas-cli build:list -p android --limit 1      # status, artifact URL
```
Open the build page on the phone, or scan the QR code, then tap **Install**. Android asks you to
allow installing from the browser ("Install unknown apps") once.

**Ship a JS-only change OTA (no reinstall)**
```bash
npx eas-cli update --channel preview --environment preview --message "what changed"
```
The app downloads the update on launch and applies it on the next cold start: close it from
recents and open it again. Always pass `--environment preview` so the update gets the same
EXPO_PUBLIC values as the build. If you changed anything native (a new library with native code,
a config plugin, permissions, `app.config.ts` native fields), the fingerprint changes. In that
case, build a new APK instead (`npx eas-cli fingerprint:compare` shows what changed).

**Adding Firebase (FCM) later**, needed for Android push delivery. Builds work without it;
push just isn't delivered.
1. In the Firebase console, add an Android app with package `com.moidy.match` and download
   `google-services.json`. Don't commit it.
2. Make it available to cloud builds as a file variable:
   `npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment preview --environment production --environment development`.
   `app.config.ts` already reads `process.env.GOOGLE_SERVICES_JSON`.
3. Upload an FCM V1 service-account key in Firebase → Project settings → Service accounts →
   Generate key, then run `npx eas-cli credentials -p android`, choose Google Service Account,
   then FCM V1.
4. Rebuild the APK. This is a native change, so the fingerprint changes and old installs need
   the new APK.

## 7. Store listing assets (to create)

- [ ] Screenshots: iPhone 6.9" and 6.5", iPad if `supportsTablet` stays true (or set it to
      false), and Android phone.
- [ ] Short and long descriptions in pt-PT and EN, keywords, support URL, marketing URL.
- [ ] Feature graphic for Play (1024×500).
- [ ] The app icon and splash are already generated in `apps/mobile/assets/images` from the
      matchstick logo; the generator is `apps/mobile/assets/source/gen-icons.py`.

## Already done in the repo (for reference)

- `eas.json` profiles: development, development-device, preview and production, each with
  its own EAS environment.
- Icons (iOS 1024 opaque, Android adaptive foreground/background/monochrome), splash on ink
  `#15121C`, notification icon, favicon.
- Permission strings: camera, microphone, photos. `ITSAppUsesNonExemptEncryption = false`.
- 18+ is enforced both in onboarding and by the DB trigger `enforce_adult`.
- In-app account deletion: the `delete-account` Edge Function removes Storage files and the
  auth user, and the user's data cascades.
- Paywall with restore purchases, auto-renew disclosure, and Terms and Privacy links.
- Clients can't write `subscriptions` or `payments`. RLS allows SELECT of own rows only, and
  the write grants are revoked.
