# Test profiles (QA / demo data)

Seeds 12 clearly-marked test accounts near Lisbon plus scenarios against one admin
account, so every differentiator can be seen on a real phone.

* Emails `test1@match.test` … `test12@match.test`; every profile has `profiles.is_test = true`
  (column not exposed to the app) and `raw_user_meta_data.test_account = true`.
* Random 20-char passwords are written **only** to `TEST_ACCOUNTS.md` in the repo root
  (git-ignored, mode 600). Nothing secret lives in this folder.
* Photos: Unsplash photos via i.pravatar.cc (Unsplash License: free use, no attribution
  required), uploaded to the `profile-photos` bucket by signing in **as each test user**
  with the public anon key, so Storage and `photos` RLS apply exactly like the app.
  No service-role key is used anywhere; other DB writes run server-side through the
  Management API SQL endpoint, and anything that reads `auth.uid()` (We met, feedback,
  events, RSVPs, stories, posts) is executed as the acting test user.

## Seed

```bash
SUPABASE_ACCESS_TOKEN=... python3 supabase/seed/seed_test_profiles.py [admin_email]   # default jojoamber1993@gmail.com
# if only the scenario step failed:  ... seed_test_profiles.py --scenarios-only
```

Refuses to run if `@match.test` users already exist (remove first).

## What the admin sees

| Feature | Test profile | How |
|---|---|---|
| Today's picks + countdown | Carolina, Alex, Joana, Marta, André, Sofia | Discover → Today's picks |
| "Real photos" trust badge | Sofia | 3 dates confirmed by both sides with positive private feedback |
| Super like / likes you | Carolina (super), Marta, Joana | picks highlight, Likes you, notifications |
| New match | Beatriz (20 min ago) | Messages |
| Conversation starters nudge | Inês (matched 26h ago, no messages) | open the chat |
| Expiring timer + Extend | Tiago (silent 84h) | Messages row timer, chat banner |
| Video call suggestion | Miguel (11 + 11 messages) | open the chat |
| We met → confirm → feedback | Rui marked "We met" | chat card / ⋯ menu |
| Archived (expired) | Duarte | Messages → Archived |
| Stories (expire 24h after seeding), feed posts, event | Inês/Miguel/Marta; Joana/Duarte/André; Miguel's "Jazz night at Hot Clube" next Friday 21:30 | Feed / Events |

## Remove everything

```bash
SUPABASE_ACCESS_TOKEN=... python3 supabase/seed/remove_test_data.py
```

Deletes the test users' Storage files (signing in as them with `TEST_ACCOUNTS.md`), then runs
`remove_test_data.sql`, which deletes the auth users; everything else cascades. The SQL file can
also be pasted into Dashboard → SQL editor on its own (then delete the photo folders listed by
its first query in Dashboard → Storage → profile-photos). The `is_test` column can stay.
