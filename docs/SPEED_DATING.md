# Speed Dating, group rooms and Speed Dating Night

Everything is server-authoritative (Postgres RPCs, no client table access), shipped as JS + DB only.
Video uses LiveKit through the `livekit-token` edge function; **in Expo Go there is no WebRTC**, so the
screens show the people's photos with "Video works in the MATCH app" and every other part of the flow
(queue, timer, picks, report, refunds) still works.

Entry points: Live tab → "⚡ Speed Dating" category chip / Speed Dating card / Group dating rooms card,
Home → Speed Dating Night banner (Fridays from 6 h before and while it's on), push/inbox `speed_night`
→ `/speed`, `live_invite` → `/speed?tab=group`. Screen: `app/speed.tsx` (tabs "1:1 dates" / "Group rooms").

## 1:1 speed dates (`20261009_speed_dating.sql`)

| Rule | Where |
| --- | --- |
| First date per Lisbon day free, then `speed_1on1_coins` = 50 coins (ledger kind `speed_date`) | `speed_join` |
| Queue with mutual preferences: gender both ways, both age ranges, distance (coarse cells), optional same intention; blocks, hidden, incognito, existing matches and partners from the last 7 days excluded | `speed_compatible`, `speed_try_pair` |
| Early leavers / no-shows paired last (`speed_reputation`) | `speed_try_pair` order |
| "Before the call": partner card, 1 shared interest, 1 icebreaker; both tap "I'm ready" within 30 s | `speed_ready`, `speed_session_json` |
| 2-minute timer (`speed_1on1_seconds`) enforced by the server (`ends_at`, `speed_tick`, cron every minute) | `speed_tick` |
| Partner leaves within 20 s (`speed_refund_seconds`) or never shows → you get your coins (or free ticket) back (`speed_refund`) | `speed_leave`, `speed_tick` |
| Report always visible; reporting files a report (+ optional block), ends the date and refunds the reporter | client `ReportSheet` + `speed_leave(…, 'report')` |
| Private Match/Pass; the partner's pick is never revealed, only a joint outcome. Mutual → likes inserted with `match.like_source = 'speed'` (skips daily like limits) → normal match + conversation → MATCH moment | `speed_choose` |
| Rate limits: join 30/h, choose 30/min, token 30/min | — |
| Leaving the queue = full refund | `speed_leave_queue` |

## Group dating rooms (`20261009_group_dating.sql`)

Up to `group_max_members` = 10 people, everyone on camera, free.

- **Roulette**: you join the fullest open/live room where someone matches your preferences both ways and nobody is blocked with you; otherwise a new room opens. It goes live at `group_min_members` = 3.
- **Interests**: one room per interest tag (lobby lists live ones; your own interests are one tap).
- **Friends**: host invites up to 9 of their matches (others are dropped server-side); invitees get a `live_invite` notification + push; the host starts once someone joined. Incognito users may use Friends rooms only.
- Live for `group_live_minutes` = 10 (or until fewer than 2 remain), then `group_pick_seconds` = 120 of **private picks**. Mutual picks become matches (same like-limit bypass). Nobody sees one-sided picks.
- Report is always visible in the room (pick the person); reporting leaves the room.

## Speed Dating Night

`speed_night_dow` = 5 (Friday), `speed_night_hour` = 21, `speed_night_hours` = 3, in Europe/Lisbon.
`get_speed_night()` drives the banners. Cron `speed-night-push` (every 5 min) inserts one `speed_night`
notification per active user with a push token ~20 min before the start, once per night, then runs the
send-push system sweep ("⚡ Speed Dating Night starts at 21:00").

## Settings (public.app_settings)

`speed_1on1_coins, speed_1on1_seconds, speed_refund_seconds, speed_ready_seconds, speed_decide_seconds,
speed_night_dow, speed_night_hour, speed_night_hours, group_max_members, group_min_members,
group_live_minutes, group_pick_seconds, group_open_minutes`.

## Tests

`supabase/tests/speed_dating.sql`, `supabase/tests/group_dating.sql`, Jest "speed dating + group rooms".
