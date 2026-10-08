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
