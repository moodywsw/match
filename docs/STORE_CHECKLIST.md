# MATCH — Store release checklist

Everything that does **not** need a store account is already done in the repo.
This list is what still needs the owner's accounts, secrets, or decisions.
Tick items as you go.

Project facts: Expo SDK 57 · EAS project `ec207fec-1ece-43a1-b5ef-d4383bc933f3` (owner `moidys-team`) ·
bundle id / package `com.match.app` · Supabase project `pkpdheytmbwvqhpcaigm`.

---

## 0. Decide the identifiers (before anything else)

- [ ] Check that `com.match.app` is available on **both** App Store Connect and Google Play.
      It is generic and may already be taken. If it is, pick something like `com.moidy.match`
      and change `ios.bundleIdentifier` and `android.package` in `apps/mobile/app.config.ts`.
      **The identifier can't be changed after the first store upload.**
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
- [ ] FCM for push (Android): download `google-services.json` from Firebase, set
      `GOOGLE_SERVICES_JSON=./google-services.json` (git-ignored), then upload the FCM V1
      key with `eas credentials`.

## 3. RevenueCat

- [ ] Create the RevenueCat project "MATCH" and add the iOS app (App Store Connect API key +
      in-app purchase key) and the Android app (service-account JSON).
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

- [ ] Auth → enable **leaked password protection**, which currently shows as an advisor
      warning. The owner said this will be handled with the final security pass.
- [ ] Auth → set the email templates and the redirect URLs (`match://`).
- [ ] Check the project region (EU recommended for GDPR) and update the privacy policy to
      match.
- [ ] Re-run Security Advisors. The remaining warnings, `ensure_conversation` and
      `get_blocked_peer_ids`, are intentional SECURITY DEFINER RPCs.
- [ ] Optional: upgrade the plan for daily backups or PITR. The privacy policy promises a
      backup retention window.

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

Install the dev client only when you move off Expo Go, because it changes how `expo start`
behaves:

```bash
cd apps/mobile
npx expo install expo-dev-client          # required for the "development" profiles
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
