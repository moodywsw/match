# MATCH — Security overview

Last full review: 2026-10-08. Supabase project: `pkpdheytmbwvqhpcaigm`.
The migrations involved are `20261008_security_hardening.sql`, `20261008_security_hardening_2.sql` and `20261008_live_rooms*.sql`.

## Status at a glance

| Area | State |
|---|---|
| Supabase security advisors | **0 open findings in the database.** The only warning left is *Leaked password protection*, which is a dashboard toggle (see "Needs the owner"). |
| RLS | Enabled on **every** table in `public` (32 tables) and on `private.user_locations` and `private.rate_limits`. |
| `anon` role | No table access at all, except `SELECT` on `public.interests` (the public catalogue). No function `EXECUTE`. Default privileges are revoked too, so new tables don't grant `anon`. |
| `authenticated` role | No `TRUNCATE`, `REFERENCES` or `TRIGGER`. Writes are scoped by RLS plus column-level grants. |
| SECURITY DEFINER | All definer functions live in `private` with `search_path = ''` and fully qualified names. The `public` RPCs are thin SECURITY INVOKER wrappers, granted to `authenticated` only. The trigger functions left in `public` (`try_create_match`, `create_conversation_for_match`) and `is_blocked_either_way` are pinned to `search_path = ''`, and none of them can be executed by API roles. |
| Secrets in git | `gitleaks` over all 34 commits found **no leaks**. A regex scan for JWTs, `sk_`, `sbp_`, AWS, GitHub, Google and private keys also came back clean. The only JWTs in the working tree are anon keys in git-ignored files (`.env`, Metro logs, `dist/`). |
| Service role key | Only exists inside Edge Functions (runtime-injected). It is never in the app or in git. |

## Data protection (PII)

- **Emails** live only in `auth.users`, which the API doesn't expose. No RPC returns an email.
- **Date of birth.** `profiles.birth_date` is *not selectable* by other members, because there is
  no column grant for it. Your own full row comes from `get_my_profile()`. Every RPC that shows
  other people (`get_discover_deck`, `get_map_people`, `get_event_attendees`,
  `get_likes_received`, `get_profile_viewers`) returns `private.age_anchor(birth_date)` instead:
  today minus the person's age in whole years. That gives the client the right age and
  nothing more. Server-side age filters still use the real date.
- **Gender, interested_in, and every settings column** (`incognito`, `show_distance`,
  `read_receipts`, `who_can_message`, `is_admin`, `hidden_at`…) can only be read by the user
  themselves.
  The columns other members can read are `id, name, city, intention, bio, verified, friday_answer, created_at, updated_at, onboarding_complete, is_discoverable`.
- **Location.** The exact position is never stored. `private.user_locations` holds a cell of
  about 1 km behind a restrictive deny-all policy. Distances are rounded, and map pins get a
  deterministic jitter of ±0.6 km per viewer.
- **Push tokens.** A device token only ever belongs to the account signed in on it now. Sign-out
  deletes it, and the `push_tokens_handoff` trigger unlinks it from every other account when it's
  registered again (this covers offline sign-outs and reinstalls), so a shared phone never gets
  the previous user's pushes.
- **Blocks.** Blocking works both ways. It hides profiles, photos, posts, comments, post likes,
  interests, stories, events, live rooms and live chat, and it stops chat and conversation
  creation.

## Write protection (clients can't escalate)

Privileged state is protected by column-level `INSERT`/`UPDATE` grants, enforced by Postgres
itself, not by client code:

- `profiles.verified`, `is_admin` and `hidden_at` aren't writable by users.
- On `reports`, users can only set `reporter_id, reported_id, category, details, post_id, comment_id, live_stream_id`. A trigger forces `reporter_id = auth.uid()` and `status = 'open'`.
- On `verifications`, users can only set `user_id, selfie_url`. The status stays `pending` until an admin reviews it.
- On `notifications`, users can only update `read_at`, so they can't forge or replay a push.
- `posts` and `comments` can't have `hidden_at` changed by their authors.
- `photos.url` must point at the owner's own folder in the `profile-photos` bucket (no hotlinking of arbitrary URLs). There's a maximum of 9 photos per user.
- `subscriptions` and `payments` can't be written by clients at all. The RevenueCat webhook writes them with the service role.
- `live_streams`, `live_viewers` and `live_match_votes` aren't writable directly. Everything goes through the RPCs (`start_live`, `join_live`, `vote_live_match`, …).

## Rate limits (server-side)

`private.hit_rate_limit(action, max, window)` is a fixed-window counter in
`private.rate_limits`. Rows are purged after 2 days by the `live-housekeeping` cron job. It is
applied in BEFORE INSERT triggers and in the RPCs, and raises `P0001 rate_limited`, which the
app maps to a friendly toast.

| Action | Limit |
|---|---|
| Chat messages | 30 per minute, 2000 per day |
| Comments | 10 per minute, 300 per day |
| Posts | 10 per hour, 30 per day |
| Stories | 30 per day |
| Event creation | 10 per day |
| Reports | 10 per day |
| Story responses | 30 per minute |
| Post likes | 60 per minute |
| Likes (swipes) | 60 per minute, plus the existing daily free-tier limits |
| Blocks | 100 per day |
| Photo uploads (rows) | 50 per day |
| Verification requests | 5 per day |
| Go live | 10 per day |
| Live chat | 20 per minute |
| Live reactions | 60 calls per minute (at most 20 hearts per call) |
| LIVE MATCH votes | 30 per minute |

## Input validation

These are CHECK constraints in the database, so they also apply to direct API calls:

| Field | Rule |
|---|---|
| Profile name | 1–50 characters |
| Bio | ≤ 500 characters |
| City | ≤ 80 characters |
| Friday answer | ≤ 120 characters |
| Gender | ≤ 40 characters |
| `interested_in` | ≤ 6 entries |
| Posts | ≤ 2000 characters; text posts can't be empty; polls have 2–4 options and are < 1 KB |
| Comments | 1–500 characters |
| Messages | 1–4000 characters, plus shape rules per type |
| Story responses | ≤ 500 characters |
| Stories | content < 4 KB; media paths must be in the owner's folder |
| Events | title 3–80 characters; description ≤ 1000; capacity 2–5000; time sanity rules |
| Live title | 1–80 characters, with a fixed category list |
| Live chat | 1–200 characters |
| Reports | fixed category list; details ≤ 1000 characters |
| Push tokens | ≤ 255 characters |

The app also caps lengths on the main inputs (live chat, report details, titles).

## Moderation

- **Report queue.** `public.reports` has a status (`open`/`reviewing`/`resolved`), a
  `resolution` (`dismissed`/`actioned`/`unhidden`), optional targets (`post_id`,
  `comment_id`, `live_stream_id`) and review fields. "Report a problem" in Settings files
  `category = 'app_problem'` with no reported user.
- **Auto-hide.** When **3 distinct reporters** report someone within 30 days, the trigger
  `private.reports_auto_hide` sets `profiles.hidden_at` and ends their live. A hidden user
  disappears from Discover, the map, stories, the feed, events, likes and live rooms. Posts and
  comments reported by 3 distinct reporters are hidden individually. Dismissed reports don't
  count.
- **Admins.** `profiles.is_admin` can only be set by the service role or the SQL editor:
  ```sql
  update public.profiles set is_admin = true where id = '<your auth user id>';
  ```
  Admins can read every report (RLS) and call these RPCs:
  - `admin_list_reports(p_status default 'open', p_limit)`
  - `admin_resolve_report(p_report_id, p_action in ('reviewing','dismiss','hide','unhide'), p_note)`
  - `admin_review_verification(p_verification_id, p_approve)`, which also sets `profiles.verified`

  There's no admin UI yet. Use the SQL editor or call the RPCs from a small internal tool
  while signed in as the admin.

## Storage

| Bucket | Public | Read | Write |
|---|---|---|---|
| `profile-photos` | yes (public URLs are used for avatars) | Signed-in users can list. Anonymous listing was removed. | Own folder `<uid>/…` only; ≤ 5 MB; images only |
| `event-covers` | yes | public URL | Own folder only; ≤ 5 MB; images only |
| `chat-media` | no | Conversation members, via signed URLs | Sender in own conversation folder; ≤ 15 MB; image/audio types only |
| `story-media` | no | Owner, or anyone who can see the story (signed URLs) | Own folder; ≤ 50 MB; image/video types only |

Expired story media is deleted hourly by the `cleanup-story-media` function and cron job.

## Edge Functions

| Function | JWT | Notes |
|---|---|---|
| `send-push` | verify_jwt | Users can only push a DB-written notification (`notification_for`) or an event change (`event_notifications`). Title and body are built server-side, and ids are validated as UUIDs. Free-form `{user_id,title,body}` is service-role only. |
| `livekit-token` | verify_jwt | Validates the `stream_id` UUID. `get_live_token_grant` checks that the room is active and that nobody is blocked. Only the host and the LIVE MATCH guest can publish. Returns 503 until the `LIVEKIT_*` secrets exist. |
| `delete-account` | verify_jwt | Needs `{confirm:"DELETE"}`. Deletes the caller's storage objects and auth user; their data cascades. |
| `revenuecat-webhook` | shared secret | Constant-time compare against `REVENUECAT_WEBHOOK_SECRET`. Returns 503 until it's set. |
| `cleanup-story-media` | verify_jwt | Idempotent garbage collection of orphaned story files, triggered by pg_cron. |

## Tests

- `supabase/tests/core_flows.sql`: a rolled-back suite that runs the core flows as real
  `authenticated` users. It covers privacy (DOB, column grants, blocks, outsiders), escalation
  attempts (self-verify, report status, unhiding), moderation auto-hide, capacity, live grants,
  rate limits, anon lockout and push-token handoff. It finishes with `ALL_TESTS_PASSED:`.
- `apps/mobile/test`: Jest smoke tests that render every route through the real auth gate and
  providers with a mocked Supabase, plus the Expo Go live-room gating.

## Needs the owner (dashboard and accounts)

1. **Auth → Password security → enable "Leaked password protection"** (HaveIBeenPwned). This
   is the only remaining advisor warning. Also consider a minimum password length of 8 or more.
2. Auth → turn on email confirmation and rate limits (the defaults are fine) and set the redirect URLs.
3. Set the secrets when the accounts exist: `REVENUECAT_WEBHOOK_SECRET`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `LIVEKIT_URL`.
4. Make yourself an admin with the SQL above, and review the report queue regularly. Apple and
   Google require a working report and block flow plus timely moderation for UGC and dating
   apps.

## Known limitations / follow-ups

- Profile photos are reachable by anyone who has the exact public URL. Paths are
  `<uid>/<timestamp>.<ext>` and listing needs sign-in. Moving to private buckets with signed
  URLs is possible later, at the cost of URL caching.
- Rate limits use fixed windows, so a burst of up to 2× the limit is possible across a window
  boundary.
- There's no automated text or image moderation yet. Moderation is report-driven only.
- Selfie verification is still a client-side demo flow. Admin review exists server-side, but the
  selfie upload pipeline isn't built.
