# Android push notifications (Firebase Cloud Messaging)

**Status:** code and config are ready. What's missing is two files that only the owner can
create (a Firebase config and a Firebase key), plus **one new APK build**.

How it works: the app gets an *Expo push token* → `public.push_tokens` → the `send-push`
edge function → Expo Push API → **FCM** → the phone. Expo needs your FCM V1 key to talk to FCM
for your app, and the APK needs `google-services.json` so Android can issue a token.
iOS and Expo Go don't change.

Already done in the repo:
- `app.config.ts` → `android.googleServicesFile` reads the EAS file variable
  `GOOGLE_SERVICES_JSON` (cloud builds) or `apps/mobile/google-services.json` (local builds).
  Both are git-ignored. Without the file the app builds and runs as it does today.
- The `expo-notifications` plugin with the notification icon and colour, and the Android
  channel `default`.
- `send-push` (deployed, v12) sends Android messages with `channelId: "default"` and
  `priority: "high"`, so chat and match pushes show as heads-up. It also deletes tokens that
  Expo reports as `DeviceNotRegistered`.
- The app registers its token after sign-in. If the build has no Firebase config it logs
  `fcm_not_configured` and carries on.
- `.gitignore` covers `google-services.json`, `*service-account*.json` and
  `*-firebase-adminsdk-*.json`.

---

## Step 1: Create the Firebase project (about 3 min)
1. Go to <https://console.firebase.google.com> → **Create a project** → name it `MATCH`.
   Google Analytics isn't needed (turn it off).
2. On the project home page click the **Android** icon (**Add app**):
   - Android package name: **`com.moidy.match`** (exactly this)
   - App nickname: `MATCH Android`. Leave the SHA-1 empty; push doesn't need it.
   - **Register app**.
3. **Download `google-services.json`**. Skip the "Add Firebase SDK" and "Next" steps; Expo
   handles them.
   Check: open the file. `"package_name": "com.moidy.match"` must appear in it.

## Step 2: Give EAS the `google-services.json`
Pick one:

**Web (no terminal):** <https://expo.dev/accounts/moidys-team/projects/match/environment-variables>
→ **Add variable** → Name `GOOGLE_SERVICES_JSON` → Type **File** → upload
`google-services.json` → visibility **Secret** → tick **development, preview, production**
→ Save.

**CLI** (from `apps/mobile`):
```bash
npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
  --visibility secret --environment development --environment preview --environment production
```

## Step 3: Create the FCM V1 key and upload it to EAS
1. Firebase console → ⚙️ **Project settings** → **Service accounts** tab →
   **Generate new private key** → **Generate key**. A JSON file such as
   `match-xxxxx-firebase-adminsdk-xxxxx.json` downloads. **Treat it like a password.** Never
   commit it or send it by chat or email.
2. Check that Project settings → **Cloud Messaging** shows *Firebase Cloud Messaging API
   (V1): Enabled* (the default for new projects).
3. Upload it to EAS. Pick one:
   - **Web:** <https://expo.dev/accounts/moidys-team/projects/match/credentials> → **Android**
     → `com.moidy.match` → **FCM V1 service account key** → **Add a service account key** →
     upload the JSON.
   - **CLI:** `npx eas-cli credentials -p android` → profile `preview` →
     **Google Service Account** → **Manage your Google Service Account Key for Push
     Notifications (FCM V1)** → **Set up a Google Service Account Key for Push Notifications
     (FCM V1)** → **Upload a new service account key** → choose the JSON.
   Then delete the JSON from your Downloads folder, or keep it in a password manager.

## Step 4: Build a new APK (required)
Adding Firebase is a **native** change, so the runtime fingerprint changes:
```bash
cd apps/mobile
npx eas-cli build -p android --profile preview
```
Install the new APK over the old one; your data stays. From then on:
- OTA updates (`eas update --channel preview --platform android --environment preview`) go
  to the **new** runtime. The old APK stops receiving updates, so everyone testing should
  install the new APK.
- Expo Go on iPhone is unaffected.

## Step 5: Test it (2 min)
1. Open the new APK, sign in and allow notifications.
2. Supabase → Table editor → `push_tokens`: there should be a row for your user with
   `platform = android` and a token `ExponentPushToken[…]`.
3. Send a test push at <https://expo.dev/notifications> by pasting that token. Or use a
   second account to like you back, or send you a message: the app pushes "It's a match!"
   or the message preview.
4. If the token row doesn't appear, run `adb logcat | grep "\[match\]"`. A line with
   `fcm_not_configured` means the build doesn't contain `google-services.json`; check step 2
   and rebuild.

## Recommended in the same new APK (optional native clean-ups)
These also change the fingerprint, so ship them in the same build as Firebase rather than
on their own. Add to `android` in `app.config.ts`:
```ts
blockedPermissions: [
  'android.permission.SYSTEM_ALERT_WINDOW',        // template default, unused
  'android.permission.READ_EXTERNAL_STORAGE',       // the photo picker doesn't need it
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_FINE_LOCATION',        // we only ever use a ~1.5 km cell
],
```
Also: `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and its foreground service come from **expo-audio**,
whose `enableBackgroundPlayback` defaults to `true`. Play Console would then ask for a
foreground-service declaration with a demo video. Voice notes don't need background playback, so
set it off in `app.config.ts`:
```ts
['expo-audio', { microphonePermission: '…', enableBackgroundPlayback: false }],
```
Then test voice notes and a LiveKit call on the new APK before releasing.
