-- Differentiator 2: chats that don't die.
-- Per-match activity tracking; 24h no-message nudge with server-generated starters;
-- 72h silence → "expiring" (48h timer, each side can Extend once) → expired (archived,
-- never deleted); video-call suggestion after N messages each. Thresholds: public.app_settings.

------------------------------------------------------------------------------
-- 0. notification types used by differentiators 2 + 3
------------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'match', 'message', 'post_like', 'comment', 'story_reply', 'super_like', 'story_like',
  'event_update', 'event_cancelled', 'missed_call', 'gift',
  'chat_nudge', 'match_expiring', 'match_expired', 'match_extended', 'we_met', 'date_feedback']));

------------------------------------------------------------------------------
-- 1. table (written only by triggers / cron / RPCs; participants can read)
------------------------------------------------------------------------------
create table if not exists public.match_lifecycle (
  match_id uuid primary key references public.matches(id) on delete cascade,
  user_a uuid not null,
  user_b uuid not null,
  state text not null default 'active' check (state in ('active', 'expiring', 'expired')),
  matched_at timestamptz not null default now(),
  last_message_at timestamptz,
  msgs_a integer not null default 0 check (msgs_a >= 0),
  msgs_b integer not null default 0 check (msgs_b >= 0),
  nudged_at timestamptz,
  expiring_at timestamptz,
  expires_at timestamptz,
  extended_a_at timestamptz,
  extended_b_at timestamptz,
  expired_at timestamptz,
  video_suggested_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists match_lifecycle_tick_idx on public.match_lifecycle (state, last_message_at, matched_at);
create index if not exists match_lifecycle_a_idx on public.match_lifecycle (user_a);
create index if not exists match_lifecycle_b_idx on public.match_lifecycle (user_b);
alter table public.match_lifecycle enable row level security;
revoke all on public.match_lifecycle from anon, authenticated;
grant select on public.match_lifecycle to authenticated;
drop policy if exists "match participants can see the lifecycle" on public.match_lifecycle;
create policy "match participants can see the lifecycle" on public.match_lifecycle
  for select to authenticated using ((select auth.uid()) in (user_a, user_b));

-- backfill existing matches
insert into public.match_lifecycle (match_id, user_a, user_b, matched_at, last_message_at, msgs_a, msgs_b)
select m.id, m.user_a, m.user_b, m.created_at,
       (select max(x.created_at) from public.messages x where x.conversation_id = c.id),
       (select count(*) from public.messages x where x.conversation_id = c.id and x.sender_id = m.user_a and x.type <> 'call'),
       (select count(*) from public.messages x where x.conversation_id = c.id and x.sender_id = m.user_b and x.type <> 'call')
from public.matches m
left join public.conversations c on c.match_id = m.id
on conflict (match_id) do nothing;

------------------------------------------------------------------------------
-- 2. triggers
------------------------------------------------------------------------------
create or replace function private.lifecycle_on_match()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.match_lifecycle (match_id, user_a, user_b, matched_at)
  values (new.id, new.user_a, new.user_b, new.created_at)
  on conflict (match_id) do nothing;
  return null;
end;
$$;
drop trigger if exists lifecycle_on_match on public.matches;
create trigger lifecycle_on_match after insert on public.matches
  for each row execute function private.lifecycle_on_match();

-- Expired matches are read-only (call summaries still land so an in-flight call can finish).
create or replace function private.lifecycle_guard_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type <> 'call' and exists (
    select 1 from public.conversations c
    join public.match_lifecycle l on l.match_id = c.match_id
    where c.id = new.conversation_id and l.state = 'expired') then
    raise exception 'match_expired' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists lifecycle_guard_message on public.messages;
create trigger lifecycle_guard_message before insert on public.messages
  for each row execute function private.lifecycle_guard_message();

create or replace function private.lifecycle_guard_call()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.match_lifecycle l where l.match_id = new.match_id and l.state = 'expired') then
    raise exception 'match_expired' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists lifecycle_guard_call on public.calls;
create trigger lifecycle_guard_call before insert on public.calls
  for each row execute function private.lifecycle_guard_call();

-- Any message (incl. call summaries) is activity: revives an expiring match, counts messages,
-- and flags the video-call suggestion once both sides have written enough.
create or replace function private.lifecycle_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_l public.match_lifecycle;
  v_n integer := private.setting_num('video_suggest_messages', 10)::integer;
begin
  update public.match_lifecycle l
     set last_message_at = greatest(coalesce(l.last_message_at, new.created_at), new.created_at),
         msgs_a = l.msgs_a + case when new.sender_id = l.user_a and new.type <> 'call' then 1 else 0 end,
         msgs_b = l.msgs_b + case when new.sender_id = l.user_b and new.type <> 'call' then 1 else 0 end,
         state = case when l.state = 'expiring' then 'active' else l.state end,
         expiring_at = case when l.state = 'expiring' then null else l.expiring_at end,
         expires_at = case when l.state = 'expiring' then null else l.expires_at end,
         updated_at = now()
    from public.conversations c
   where c.id = new.conversation_id and l.match_id = c.match_id
  returning l.* into v_l;
  if found and v_l.video_suggested_at is null and v_l.msgs_a >= v_n and v_l.msgs_b >= v_n
     and not exists (select 1 from public.calls k where k.match_id = v_l.match_id and k.answered_at is not null) then
    update public.match_lifecycle set video_suggested_at = now() where match_id = v_l.match_id;
  end if;
  return null;
end;
$$;
drop trigger if exists lifecycle_on_message on public.messages;
create trigger lifecycle_on_message after insert on public.messages
  for each row execute function private.lifecycle_on_message();

------------------------------------------------------------------------------
-- 3. conversation starters (deterministic, AI-free, from shared interests / their
--    Friday answer / intention / city)
------------------------------------------------------------------------------
create or replace function private.starter_for(p_category text, p_label text, p_city text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_category = 'music' and p_label ilike '%concert%' then 'What''s the best concert you''ve ever been to?'
    when p_category = 'music' then 'What''s the last ' || p_label || ' song you had on repeat? 🎧'
    when p_label = 'Cooking' then 'What''s your signature dish? 🍳'
    when p_label = 'Wine' then 'Red, white or vinho verde? 🍷'
    when p_label = 'Coffee' then 'Where''s the best coffee ' || coalesce('in ' || p_city, 'around here') || '? ☕'
    when p_category = 'food' then 'Where''s the best ' || lower(p_label) || ' spot you know?'
    when p_label = 'Cinema' then 'What''s the last film you saw at the cinema? 🍿'
    when p_label ilike 'Documentar%' then 'What''s a documentary that changed how you see something?'
    when p_category = 'movies' then 'What''s a ' || lower(p_label) || ' movie you could rewatch forever? 🎬'
    when p_label = 'Travel' then 'What''s the best trip you''ve ever taken? ✈️'
    when p_label = 'Pets' then 'Tell me about your pet — photos very welcome 🐾'
    when p_label = 'Reading' then 'What are you reading right now? 📚'
    when p_label = 'Beach' then 'Favourite beach — go! 🏖️'
    when p_label = 'Gaming' then 'What are you playing at the moment? 🎮'
    when p_label = 'Hiking' then 'Best hike you''ve ever done? 🥾'
    when p_label = 'Nightlife' then 'Where''s your go-to spot for a night out?'
    else 'How did you get into ' || lower(p_label) || '?'
  end;
$$;

create or replace function private.conversation_starters(p_conversation_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches;
  v_other uuid;
  v_them public.profiles;
  v_out text[] := '{}';
  r record;
begin
  select m.* into v_m from public.conversations c join public.matches m on m.id = c.match_id where c.id = p_conversation_id;
  if not found or v_uid is null or v_uid not in (v_m.user_a, v_m.user_b) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  v_other := case when v_m.user_a = v_uid then v_m.user_b else v_m.user_a end;
  if public.is_blocked_either_way(v_uid, v_other) then return v_out; end if;
  select * into v_them from public.profiles where id = v_other;

  -- up to two from shared interests (one per category), stable per match
  for r in
    select distinct on (i.category) i.category, i.label
      from public.user_interests a
      join public.user_interests b on b.interest_id = a.interest_id and b.user_id = v_other
      join public.interests i on i.id = a.interest_id
     where a.user_id = v_uid
     order by i.category, md5(i.label || v_m.id::text)
  loop
    exit when cardinality(v_out) >= 2;
    v_out := v_out || private.starter_for(r.category, r.label, v_them.city);
  end loop;

  if v_them.friday_answer is not null and cardinality(v_out) < 3 then
    v_out := v_out || ('Your perfect Friday is “' || left(v_them.friday_answer, 80) || '” — what would make it a 10/10?');
  end if;
  if cardinality(v_out) < 3 and v_them.intention is not null
     and v_them.intention = (select p.intention from public.profiles p where p.id = v_uid)
     and private.intention_phrase(v_them.intention) is not null then
    v_out := v_out || ('We''re both here for ' || private.intention_phrase(v_them.intention) || ' — what does a great first date look like to you?');
  end if;
  if cardinality(v_out) < 3 and v_them.city is not null then
    v_out := v_out || ('What''s your favourite hidden spot in ' || v_them.city || '?');
  end if;
  if cardinality(v_out) < 3 then
    v_out := v_out || (array[
      'If you could teleport anywhere this weekend, where would you go?',
      'What''s something small that made you smile this week?',
      'What''s the best thing you''ve eaten recently?'
    ])[1 + (abs(hashtext(v_m.id::text)) % 3)];
  end if;
  if cardinality(v_out) < 3 then
    v_out := v_out || 'What are you most looking forward to this month?'::text;
  end if;
  return v_out[1:3];
end;
$$;
revoke all on function private.conversation_starters(uuid) from public, anon;
grant execute on function private.conversation_starters(uuid) to authenticated;
create or replace function public.get_conversation_starters(p_conversation_id uuid)
returns text[] language sql stable security invoker set search_path = ''
as $$ select private.conversation_starters(p_conversation_id) $$;
revoke all on function public.get_conversation_starters(uuid) from public, anon;
grant execute on function public.get_conversation_starters(uuid) to authenticated;

------------------------------------------------------------------------------
-- 4. Extend (each participant once per match; only while expiring)
------------------------------------------------------------------------------
create or replace function private.extend_match(p_match_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_l public.match_lifecycle;
  v_other uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_l from public.match_lifecycle where match_id = p_match_id for update;
  if not found or v_uid not in (v_l.user_a, v_l.user_b) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  v_other := case when v_l.user_a = v_uid then v_l.user_b else v_l.user_a end;
  if public.is_blocked_either_way(v_uid, v_other) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if v_l.state <> 'expiring' then raise exception 'not_expiring' using errcode = 'P0001'; end if;
  if (v_uid = v_l.user_a and v_l.extended_a_at is not null) or (v_uid = v_l.user_b and v_l.extended_b_at is not null) then
    raise exception 'already_extended' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('extend_match_day', 20, interval '1 day');
  update public.match_lifecycle
     set expires_at = expires_at + make_interval(hours => private.setting_num('extend_hours', 48)::integer),
         extended_a_at = case when v_uid = user_a then now() else extended_a_at end,
         extended_b_at = case when v_uid = user_b then now() else extended_b_at end,
         updated_at = now()
   where match_id = p_match_id
  returning * into v_l;
  perform private.add_notification(v_other, v_uid, 'match_extended', jsonb_build_object(
    'match_id', p_match_id,
    'conversation_id', (select c.id from public.conversations c where c.match_id = p_match_id),
    'expires_at', v_l.expires_at));
  return v_l.expires_at;
end;
$$;
revoke all on function private.extend_match(uuid) from public, anon;
grant execute on function private.extend_match(uuid) to authenticated;
create or replace function public.extend_match(p_match_id uuid)
returns timestamptz language sql security invoker set search_path = ''
as $$ select private.extend_match(p_match_id) $$;
revoke all on function public.extend_match(uuid) from public, anon;
grant execute on function public.extend_match(uuid) to authenticated;

------------------------------------------------------------------------------
-- 5. periodic tick (pg_cron): nudges → expiring → expired. Blocks respected
--    (add_notification skips blocked pairs). Matches where someone said
--    "We met" never expire (date_confirmations is created in the next migration;
--    the check is dynamic-safe via to_regclass).
------------------------------------------------------------------------------
create or replace function private.match_lifecycle_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_conv uuid;
  v_nudged int := 0; v_expiring int := 0; v_expired int := 0;
  v_nudge interval := make_interval(hours => private.setting_num('nudge_after_hours', 24)::integer);
  v_silence interval := make_interval(hours => private.setting_num('expiring_after_hours', 72)::integer);
  v_window interval := make_interval(hours => private.setting_num('expire_window_hours', 48)::integer);
  v_has_dates boolean := to_regclass('public.date_confirmations') is not null;
begin
  -- 1) no message within 24h of matching → nudge both (once)
  for r in
    select l.match_id, l.user_a, l.user_b from public.match_lifecycle l
     where l.state = 'active' and l.last_message_at is null and l.nudged_at is null
       and l.matched_at < now() - v_nudge
     order by l.matched_at limit 500
     for update skip locked
  loop
    update public.match_lifecycle set nudged_at = now(), updated_at = now() where match_id = r.match_id;
    select c.id into v_conv from public.conversations c where c.match_id = r.match_id;
    perform private.add_notification(r.user_a, r.user_b, 'chat_nudge', jsonb_build_object('match_id', r.match_id, 'conversation_id', v_conv));
    perform private.add_notification(r.user_b, r.user_a, 'chat_nudge', jsonb_build_object('match_id', r.match_id, 'conversation_id', v_conv));
    v_nudged := v_nudged + 1;
  end loop;

  -- 2) silence → expiring (48h timer)
  for r in
    select l.match_id, l.user_a, l.user_b from public.match_lifecycle l
     where l.state = 'active' and coalesce(l.last_message_at, l.matched_at) < now() - v_silence
     order by coalesce(l.last_message_at, l.matched_at) limit 500
     for update skip locked
  loop
    if v_has_dates and exists (select 1 from public.date_confirmations d where d.match_id = r.match_id) then
      continue;
    end if;
    update public.match_lifecycle
       set state = 'expiring', expiring_at = now(), expires_at = now() + v_window, updated_at = now()
     where match_id = r.match_id;
    select c.id into v_conv from public.conversations c where c.match_id = r.match_id;
    perform private.add_notification(r.user_a, r.user_b, 'match_expiring', jsonb_build_object('match_id', r.match_id, 'conversation_id', v_conv, 'expires_at', now() + v_window));
    perform private.add_notification(r.user_b, r.user_a, 'match_expiring', jsonb_build_object('match_id', r.match_id, 'conversation_id', v_conv, 'expires_at', now() + v_window));
    v_expiring := v_expiring + 1;
  end loop;

  -- 3) timer ran out → expired (archived, both notified)
  for r in
    select l.match_id, l.user_a, l.user_b from public.match_lifecycle l
     where l.state = 'expiring' and l.expires_at <= now()
     order by l.expires_at limit 500
     for update skip locked
  loop
    update public.match_lifecycle set state = 'expired', expired_at = now(), updated_at = now() where match_id = r.match_id;
    select c.id into v_conv from public.conversations c where c.match_id = r.match_id;
    perform private.add_notification(r.user_a, r.user_b, 'match_expired', jsonb_build_object('match_id', r.match_id, 'conversation_id', v_conv));
    perform private.add_notification(r.user_b, r.user_a, 'match_expired', jsonb_build_object('match_id', r.match_id, 'conversation_id', v_conv));
    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object('nudged', v_nudged, 'expiring', v_expiring, 'expired', v_expired);
end;
$$;
revoke all on function private.match_lifecycle_tick() from public, anon, authenticated;
