# Database tests

`core_flows.sql` is a single `DO` block that exercises the core flows end-to-end
against the real schema, as real `authenticated` users (via `request.jwt.claims`
+ `set local role authenticated`), and then **always raises** so the whole
transaction is rolled back — nothing is left behind.

Covered: profile creation (18+ check, own-row RPC, no self-verify), discover deck
(age anchor instead of DOB, column privacy), likes → match → conversation →
messages → notifications → read receipts, outsider isolation, blocks, stories +
polls, feed posts/comments/likes, report auto-hide + moderation privileges,
events (auto-RSVP, capacity, counts, block visibility), live rooms (host/guest
publish grants, viewer join, chat, reactions, votes, end), rate limits, anon
lockout and push-token handoff between accounts.

Run it with the Supabase SQL editor / `psql` / MCP `execute_sql`:

```
psql "$DATABASE_URL" -f supabase/tests/core_flows.sql
```

Expected result is an error whose message starts with
`ALL_TESTS_PASSED:` followed by the list of sections. Any other error is a
failing assertion (the message names it).

## Other suites (same pattern, each rolls back)

| File | Expected message prefix | Covers |
| --- | --- | --- |
| `calls.sql` | `CALL_TESTS_PASSED:` | 1:1 calls: accept/end, missed, decline, expiry, blocks, rate limit |
| `differentiators.sql` | `DIFF_TESTS_PASSED:` | daily picks, nudges, expiring chats + extend, we-met + feedback, trust |
| `wallet_gifts.sql` | `WALLET_TESTS_PASSED:` | wallet lockdown, credits, gifts + rate limit, reversals, admin |
| `live_dating.sql` | `LIVE_TESTS_PASSED:` | LIVE for dating: watch vs interact gating (complete profile / verified-photo switch), hosting rules (7-day account age, incognito), like-from-live → match (daily limits, blocks, incognito), no DMs without a match for viewers, host moderation (remove/mute/comments off/pin), speed-dating rounds, question of the night |

Run them all:

```
for f in supabase/tests/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Several suites first make their throwaway users "live-eligible" (bio, intention,
photo, 3 interests, account older than 7 days) because commenting, gifting and
hosting in LIVE are gated server-side.
