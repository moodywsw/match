-- LIVE, reshaped for a dating app.
--  1. Watching is open to everyone; commenting / gifting need a complete profile
--     (+ verified photo once real selfie verification ships: app_settings.live_require_verified_photo).
--  2. Hosting: account >= live_host_min_account_days old, complete profile, not incognito. Server-enforced.
--  3. Match from live: like the host / people on stage; host (or LIVE MATCH guest) can like viewers who
--     commented. Goes through public.likes, so daily like limits, blocks and the match trigger all apply.
--  4. Room types: 'speed_dating' (host + up to 3 daters, rotating timed rounds run by the host) and
--     'question_night' (Question of the night, defaults to the Friday-night prompt, host can pin answers).
--  5. Safety: host can remove / mute / unseat people and mute all comments; blocks hide rooms, chat
--     lines and stage members either way; no location is ever exposed by any live RPC.
--  6. Private messages still require a match (conversations exist only for matches) — covered by tests.

------------------------------------------------------------------------------
-- settings
------------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('live_host_min_account_days', '7', 'Accounts must be at least this many days old to go live (admins exempt for QA/moderation)'),
  ('live_require_verified_photo', '0', 'TODO switch: set to 1 when real selfie verification ships; live comments/gifts/hosting then also need profiles.verified'),
  ('live_min_interests', '3', 'Interests needed for a complete profile (live comments, gifts, hosting, speed dating seats)'),
  ('speed_round_seconds', '180', 'Speed dating round length in seconds'),
  ('speed_max_participants', '4', 'Speed dating: people in the rotation, host included'),
  ('speed_min_participants', '3', 'Speed dating: people needed (host included) before the host can start a round')
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- schema
------------------------------------------------------------------------------
alter table public.live_streams
  add column if not exists room_type text not null default 'standard',
  add column if not exists question text,
  add column if not exists comments_muted boolean not null default false,
  add column if not exists pinned_message_id uuid references public.live_messages(id) on delete set null,
  add column if not exists round_number integer not null default 0,
  add column if not exists round_started_at timestamptz,
  add column if not exists round_seconds integer not null default 180;
create index if not exists live_streams_pinned_message_idx on public.live_streams (pinned_message_id) where pinned_message_id is not null;
alter table public.live_streams drop constraint if exists live_streams_room_check;
alter table public.live_streams add constraint live_streams_room_check check (
  room_type in ('standard', 'speed_dating', 'question_night')
  and (question is null or char_length(btrim(question)) between 3 and 140)
  and (room_type <> 'question_night' or question is not null)
  and (room_type = 'standard' or (guest_id is null and not is_live_match))
  and round_number >= 0 and round_seconds between 60 and 600
  and (room_type = 'speed_dating' or (round_number = 0 and round_started_at is null))
);

-- people on the speed-dating stage (the host is always in the rotation and has no row here)
create table if not exists public.live_participants (
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seat smallint not null check (seat between 1 and 9),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (stream_id, user_id),
  unique (stream_id, seat)
);
create index if not exists live_participants_user_idx on public.live_participants (user_id);
alter table public.live_participants enable row level security;
revoke all on public.live_participants from anon;
revoke insert, update, delete, truncate on public.live_participants from authenticated;

-- per-room moderation by the host
create table if not exists public.live_moderation (
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  removed_at timestamptz,
  muted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (stream_id, user_id)
);
create index if not exists live_moderation_user_idx on public.live_moderation (user_id);
alter table public.live_moderation enable row level security;
revoke all on public.live_moderation from anon;
revoke insert, update, delete, truncate on public.live_moderation from authenticated;

------------------------------------------------------------------------------
-- eligibility
------------------------------------------------------------------------------
-- What's missing before p_user may comment / gift / take a seat / host. Empty array = complete.
create or replace function private.live_missing(p_user uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array_remove(array[
      case when coalesce(btrim(p.name), '') = '' or not p.onboarding_complete then 'basics' end,
      case when not exists (select 1 from public.photos ph where ph.user_id = p.id) then 'photo' end,
      case when coalesce(btrim(p.bio), '') = '' then 'bio' end,
      case when p.intention is null then 'intention' end,
      case when (select count(*) from public.user_interests ui where ui.user_id = p.id)
                < private.setting_num('live_min_interests', 3) then 'interests' end,
      case when private.setting_num('live_require_verified_photo', 0) >= 1 and not p.verified then 'verified_photo' end
    ], null)
    from public.profiles p where p.id = p_user), array['basics']);
$$;

create or replace function private.live_require_interact()
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_missing text[];
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if private.is_hidden_user(v_uid) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  v_missing := private.live_missing(v_uid);
  if cardinality(v_missing) > 0 then
    raise exception 'profile_incomplete' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
  end if;
end;
$$;

-- null = may host; otherwise the reason code
create or replace function private.live_host_block(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null or p.hidden_at is not null then 'not_allowed'
    when p.incognito then 'incognito_live'
    when cardinality(private.live_missing(p.id)) > 0 then 'profile_incomplete'
    when not p.is_admin
         and p.created_at > now() - make_interval(days => private.setting_num('live_host_min_account_days', 7)::integer)
      then 'account_too_new'
  end
  from (select 1) one left join public.profiles p on p.id = p_user;
$$;

create or replace function private.live_eligibility()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_watch', true,
    'can_interact', cardinality(private.live_missing(p.id)) = 0 and p.hidden_at is null,
    'missing', to_jsonb(private.live_missing(p.id)),
    'can_host', private.live_host_block(p.id) is null,
    'host_block', private.live_host_block(p.id),
    'host_ready_at', case when private.live_host_block(p.id) = 'account_too_new'
      then p.created_at + make_interval(days => private.setting_num('live_host_min_account_days', 7)::integer) end,
    'host_min_days', private.setting_num('live_host_min_account_days', 7)::integer,
    'verified_required', private.setting_num('live_require_verified_photo', 0) >= 1)
  from public.profiles p where p.id = (select auth.uid());
$$;

------------------------------------------------------------------------------
-- visibility: removed people and blocks with anyone on stage hide the room
------------------------------------------------------------------------------
create or replace function private.live_can_see(p_stream_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_streams s
    where s.id = p_stream_id
      and (select auth.uid()) is not null
      and (s.host_id = (select auth.uid()) or not private.is_hidden_user(s.host_id))
      and not public.is_blocked_either_way(s.host_id, (select auth.uid()))
      and (s.guest_id is null or not public.is_blocked_either_way(s.guest_id, (select auth.uid())))
      and not exists (select 1 from public.live_moderation x
                       where x.stream_id = s.id and x.user_id = (select auth.uid()) and x.removed_at is not null)
      and not exists (select 1 from public.live_participants lp
                       where lp.stream_id = s.id and public.is_blocked_either_way(lp.user_id, (select auth.uid())))
  );
$$;

create or replace function private.live_removed(p_stream_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.live_moderation x
                  where x.stream_id = p_stream_id and x.user_id = p_user and x.removed_at is not null);
$$;

create or replace function private.is_live_host(p_stream_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.live_streams s where s.id = p_stream_id and s.host_id = (select auth.uid()));
$$;

drop policy if exists "room chat visible to permitted viewers" on public.live_messages;
create policy "room chat visible to permitted viewers" on public.live_messages for select to authenticated
  using (private.live_can_see(stream_id) and not private.blocked_with_me(user_id)
         and not private.live_removed(stream_id, user_id));

drop policy if exists "stage visible to permitted viewers" on public.live_participants;
create policy "stage visible to permitted viewers" on public.live_participants for select to authenticated
  using (private.live_can_see(stream_id) and not private.blocked_with_me(user_id));

drop policy if exists "own moderation state or host" on public.live_moderation;
create policy "own moderation state or host" on public.live_moderation for select to authenticated
  using (user_id = (select auth.uid()) or private.is_live_host(stream_id));

-- chat: comments muted / muted person / profile completeness (host + LIVE MATCH guest exempt from completeness)
create or replace function private.live_messages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  new.user_id := v_uid;
  new.body := btrim(new.body);
  new.created_at := now();
  perform private.hit_rate_limit('live_message', 20, interval '1 minute');
  select * into s from public.live_streams where id = new.stream_id;
  if found and v_uid is distinct from s.host_id and v_uid is distinct from s.guest_id then
    if s.comments_muted then raise exception 'comments_muted' using errcode = 'P0001'; end if;
    if exists (select 1 from public.live_moderation x
                where x.stream_id = new.stream_id and x.user_id = v_uid and x.muted_at is not null) then
      raise exception 'muted_in_live' using errcode = 'P0001';
    end if;
    perform private.live_require_interact();
  end if;
  return new;
end;
$$;

------------------------------------------------------------------------------
-- speed dating: lineup + deterministic round-robin pairing
------------------------------------------------------------------------------
-- All pairs of 1..n in circle-method order (byes dropped): every round is one pair in the spotlight.
create or replace function private.speed_pair_order(n integer)
returns table (ord integer, a integer, b integer) language plpgsql immutable set search_path = '' as $$
declare m integer; arr integer[]; r integer; i integer; k integer := 0; x integer; y integer;
begin
  if n is null or n < 2 then return; end if;
  m := case when n % 2 = 0 then n else n + 1 end;
  arr := array(select generate_series(1, m));
  for r in 1 .. m - 1 loop
    for i in 1 .. m / 2 loop
      x := arr[i]; y := arr[m - i + 1];
      if x <= n and y <= n then
        k := k + 1; ord := k; a := least(x, y); b := greatest(x, y);
        return next;
      end if;
    end loop;
    arr := array[arr[1], arr[m]] || arr[2:m - 1];
  end loop;
end;
$$;

-- host first, then seated daters still present (heartbeat within 75s), by seat
create or replace function private.speed_lineup(p_stream_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select array[s.host_id] || coalesce((
    select array_agg(lp.user_id order by lp.seat) from public.live_participants lp
     where lp.stream_id = s.id and lp.last_seen_at > now() - interval '75 seconds'), '{}')
  from public.live_streams s where s.id = p_stream_id;
$$;

create or replace function private.speed_round_pair(p_stream_id uuid)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare s record; v_line uuid[]; v_n integer; v_total integer; v_a integer; v_b integer;
begin
  select * into s from public.live_streams where id = p_stream_id;
  if not found or s.room_type <> 'speed_dating' or s.round_number < 1 then return null; end if;
  v_line := private.speed_lineup(p_stream_id);
  v_n := cardinality(v_line);
  if v_n < 2 then return null; end if;
  select count(*) into v_total from private.speed_pair_order(v_n);
  select o.a, o.b into v_a, v_b from private.speed_pair_order(v_n) o where o.ord = ((s.round_number - 1) % v_total) + 1;
  return array[v_line[v_a], v_line[v_b]];
end;
$$;

------------------------------------------------------------------------------
-- RPC bodies
------------------------------------------------------------------------------
drop function if exists public.start_live(text, text, uuid);
drop function if exists private.start_live(text, text, uuid);
create or replace function private.start_live(p_title text, p_category text, p_guest_id uuid default null,
                                              p_room_type text default 'standard', p_question text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_block text;
  v_type text := coalesce(nullif(btrim(p_room_type), ''), 'standard');
  v_q text := nullif(btrim(coalesce(p_question, '')), '');
  v_cat text := coalesce(p_category, 'Talk');
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  v_block := private.live_host_block(v_uid);
  if v_block = 'profile_incomplete' then
    raise exception 'profile_incomplete' using errcode = 'P0001', detail = array_to_string(private.live_missing(v_uid), ',');
  elsif v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;
  if v_type not in ('standard', 'speed_dating', 'question_night') then
    raise exception 'invalid_room_type' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('go_live', 10, interval '1 day');
  if p_guest_id is not null then
    if v_type <> 'standard'
       or p_guest_id = v_uid
       or public.is_blocked_either_way(p_guest_id, v_uid)
       or private.is_hidden_user(p_guest_id)
       or not exists (select 1 from public.matches m
                      where (m.user_a = v_uid and m.user_b = p_guest_id) or (m.user_b = v_uid and m.user_a = p_guest_id)) then
      raise exception 'guest_not_allowed' using errcode = 'P0001';
    end if;
  end if;
  if v_type <> 'standard' then v_cat := 'Dating'; end if;
  if v_type = 'question_night' then
    v_q := left(coalesce(v_q, 'What does your perfect Friday night look like?'), 140);
    if char_length(v_q) < 3 then raise exception 'invalid_question' using errcode = 'P0001'; end if;
  else
    v_q := null;
  end if;
  update public.live_streams set ended_at = now() where host_id = v_uid and ended_at is null;
  insert into public.live_streams (host_id, guest_id, title, category, is_live_match, started_at, last_heartbeat_at,
                                   room_type, question, round_seconds)
  values (v_uid, p_guest_id, left(btrim(coalesce(nullif(btrim(p_title), ''), 'Untitled live')), 80),
          v_cat, p_guest_id is not null, now(), now(), v_type, v_q,
          greatest(60, least(600, private.setting_num('speed_round_seconds', 180)::integer)))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.join_live(p_stream_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  select * into s from public.live_streams where id = p_stream_id;
  if not found or s.ended_at is not null then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if s.host_id = v_uid or s.guest_id = v_uid then
    update public.live_streams set last_heartbeat_at = now() where id = p_stream_id;
    return case when s.host_id = v_uid then 'host' else 'guest' end;
  end if;
  if not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if private.live_removed(p_stream_id, v_uid) then raise exception 'removed_from_live' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  insert into public.live_viewers (stream_id, viewer_id, joined_at, last_seen_at)
  values (p_stream_id, v_uid, now(), now())
  on conflict (stream_id, viewer_id) do update set last_seen_at = now();
  update public.live_participants set last_seen_at = now() where stream_id = p_stream_id and user_id = v_uid;
  return case when found then 'dater' else 'viewer' end;
end;
$$;

create or replace function private.leave_live(p_stream_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.live_viewers where stream_id = p_stream_id and viewer_id = (select auth.uid());
  delete from public.live_participants where stream_id = p_stream_id and user_id = (select auth.uid());
$$;

drop function if exists public.get_live_rooms(text);
drop function if exists private.live_rooms(text);
create or replace function private.live_rooms(p_category text default null)
returns table (id uuid, host_id uuid, host_name text, guest_id uuid, guest_name text, title text, category text,
               is_live_match boolean, started_at timestamptz, viewers integer, reactions integer, is_mine boolean,
               room_type text, question text, daters integer)
language sql stable security definer set search_path = '' as $$
  select s.id, s.host_id, h.name, s.guest_id, g.name, s.title, s.category, s.is_live_match, s.started_at,
         (select count(*) from public.live_viewers v
           where v.stream_id = s.id and v.last_seen_at > now() - interval '75 seconds')::integer,
         s.reaction_count, s.host_id = (select auth.uid()),
         s.room_type, s.question,
         (select count(*) from public.live_participants lp
           where lp.stream_id = s.id and lp.last_seen_at > now() - interval '75 seconds')::integer
  from public.live_streams s
  join public.profiles h on h.id = s.host_id
  left join public.profiles g on g.id = s.guest_id
  where (select auth.uid()) is not null
    and s.ended_at is null and s.last_heartbeat_at > now() - interval '2 minutes'
    and private.live_can_see(s.id)
    and (p_category is null or s.category = p_category)
  order by 10 desc, s.started_at desc
  limit 60;
$$;

drop function if exists public.get_live_state(uuid);
drop function if exists private.live_state(uuid);
create or replace function private.live_state(p_stream_id uuid)
returns table (status text, viewers integer, reactions integer, yes_votes integer, no_votes integer, my_vote boolean,
               room_type text, question text, comments_muted boolean, pinned jsonb,
               round_number integer, round_started_at timestamptz, round_ends_at timestamptz, round_pair uuid[],
               stage jsonb, my_status text, can_interact boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid)
  select case when s.ended_at is null and s.last_heartbeat_at > now() - interval '2 minutes' then 'live' else 'ended' end,
         (select count(*) from public.live_viewers v where v.stream_id = s.id and v.last_seen_at > now() - interval '75 seconds')::integer,
         s.reaction_count,
         (select count(*) from public.live_match_votes x where x.stream_id = s.id and x.vote)::integer,
         (select count(*) from public.live_match_votes x where x.stream_id = s.id and not x.vote)::integer,
         (select x.vote from public.live_match_votes x where x.stream_id = s.id and x.voter_id = me.uid),
         s.room_type, s.question, s.comments_muted,
         (select jsonb_build_object('id', lm.id, 'user_id', lm.user_id, 'name', coalesce(pp.name, 'Member'), 'body', lm.body)
            from public.live_messages lm left join public.profiles pp on pp.id = lm.user_id
           where lm.id = s.pinned_message_id and not public.is_blocked_either_way(lm.user_id, me.uid)
             and not private.live_removed(s.id, lm.user_id)),
         s.round_number, s.round_started_at,
         case when s.round_started_at is not null then s.round_started_at + make_interval(secs => s.round_seconds) end,
         private.speed_round_pair(s.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', st.uid, 'name', coalesce(pr.name, 'Member'), 'role', st.role, 'seat', st.seat,
                    'liked', exists (select 1 from public.likes l where l.liker_id = me.uid and l.liked_id = st.uid),
                    'matched', exists (select 1 from public.matches m
                                        where m.user_a = least(me.uid, st.uid) and m.user_b = greatest(me.uid, st.uid)))
                  order by st.seat), '[]'::jsonb)
            from (select s.host_id as uid, 'host'::text as role, 0 as seat
                  union all select s.guest_id, 'guest', 0 where s.guest_id is not null
                  union all select lp.user_id, 'dater', lp.seat from public.live_participants lp
                   where lp.stream_id = s.id and lp.last_seen_at > now() - interval '75 seconds') st
            join public.profiles pr on pr.id = st.uid
           where pr.hidden_at is null and (st.uid = me.uid or not public.is_blocked_either_way(st.uid, me.uid))),
         case when exists (select 1 from public.live_moderation x where x.stream_id = s.id and x.user_id = me.uid and x.muted_at is not null)
              then 'muted' else 'ok' end,
         cardinality(private.live_missing(me.uid)) = 0
  from public.live_streams s, me
  where s.id = p_stream_id and private.live_can_see(s.id);
$$;

create or replace function private.live_token_grant(p_stream_id uuid)
returns table (room text, identity text, display_name text, can_publish boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into s from public.live_streams where id = p_stream_id;
  if not found or not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  return query
    select 'match-live-' || s.id::text, v_uid::text,
           coalesce((select p.name from public.profiles p where p.id = v_uid), 'Member'),
           (v_uid = s.host_id or v_uid is not distinct from s.guest_id
            or exists (select 1 from public.live_participants lp where lp.stream_id = s.id and lp.user_id = v_uid));
end;
$$;

create or replace function private.send_live_gift(p_stream_id uuid, p_gift_id text, p_quantity integer default 1)
returns table (gift_event_id uuid, coins_balance bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  g public.gifts;
  v_host uuid;
  v_ended timestamptz;
  v_event uuid;
  v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  select * into g from public.gifts where id = p_gift_id and active;
  if not found then raise exception 'invalid_gift' using errcode = 'P0001'; end if;

  select s.host_id, s.ended_at into v_host, v_ended from public.live_streams s where s.id = p_stream_id;
  if not found then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if v_ended is not null or not private.live_is_active(p_stream_id) then
    raise exception 'stream_ended' using errcode = 'P0001';
  end if;
  if not private.live_can_see(p_stream_id) or private.is_hidden_user(v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_host = v_uid then raise exception 'cannot_gift_self' using errcode = 'P0001'; end if;
  perform private.live_require_interact();

  perform private.hit_rate_limit('gift_min', 30, interval '1 minute');
  perform private.hit_rate_limit('gift_day', 1000, interval '1 day');

  insert into public.gift_events (gift_id, sender_id, receiver_id, live_stream_id, quantity, coins, diamonds)
  values (g.id, v_uid, v_host, p_stream_id, p_quantity, g.coin_price * p_quantity, g.diamond_value * p_quantity)
  returning id into v_event;

  v_bal := private.wallet_apply(v_uid, 'coins', -(g.coin_price * p_quantity)::bigint, 'gift_sent', v_event);
  if g.diamond_value > 0 then
    perform private.wallet_apply(v_host, 'diamonds', (g.diamond_value * p_quantity)::bigint, 'gift_received', v_event);
  end if;

  return query select v_event, v_bal;
end;
$$;

-- speed dating seats
create or replace function private.live_take_seat(p_stream_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record; v_seat integer; v_max integer;
begin
  select * into s from public.live_streams where id = p_stream_id for update;
  if not found or s.room_type <> 'speed_dating' then raise exception 'not_speed_dating' using errcode = 'P0001'; end if;
  if not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if s.host_id = v_uid then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if private.live_removed(p_stream_id, v_uid) then raise exception 'removed_from_live' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  perform private.live_require_interact();
  if (select incognito from public.profiles where id = v_uid) then raise exception 'incognito_live' using errcode = 'P0001'; end if;
  if exists (select 1 from public.live_moderation x where x.stream_id = p_stream_id and x.user_id = v_uid and x.muted_at is not null) then
    raise exception 'muted_in_live' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('live_seat', 10, interval '1 minute');
  select lp.seat into v_seat from public.live_participants lp where lp.stream_id = p_stream_id and lp.user_id = v_uid;
  if found then
    update public.live_participants set last_seen_at = now() where stream_id = p_stream_id and user_id = v_uid;
    return v_seat;
  end if;
  -- free the seats of people who dropped out
  delete from public.live_participants where stream_id = p_stream_id and last_seen_at < now() - interval '75 seconds';
  v_max := greatest(2, least(9, private.setting_num('speed_max_participants', 4)::integer)) - 1;
  if (select count(*) from public.live_participants where stream_id = p_stream_id) >= v_max then
    raise exception 'stage_full' using errcode = 'P0001';
  end if;
  select min(x) into v_seat from generate_series(1, v_max) x
   where x not in (select lp.seat from public.live_participants lp where lp.stream_id = p_stream_id);
  insert into public.live_participants (stream_id, user_id, seat) values (p_stream_id, v_uid, v_seat);
  insert into public.live_viewers (stream_id, viewer_id, joined_at, last_seen_at) values (p_stream_id, v_uid, now(), now())
  on conflict (stream_id, viewer_id) do update set last_seen_at = now();
  return v_seat;
end;
$$;

create or replace function private.live_leave_seat(p_stream_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.live_participants where stream_id = p_stream_id and user_id = (select auth.uid());
$$;

create or replace function private.live_next_round(p_stream_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record; v_n integer;
begin
  select * into s from public.live_streams where id = p_stream_id for update;
  if not found or s.host_id is distinct from v_uid then raise exception 'not_host' using errcode = 'P0001'; end if;
  if s.room_type <> 'speed_dating' then raise exception 'not_speed_dating' using errcode = 'P0001'; end if;
  if not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('live_round', 30, interval '1 minute');
  v_n := cardinality(private.speed_lineup(p_stream_id));
  if v_n < greatest(2, private.setting_num('speed_min_participants', 3)::integer) then
    raise exception 'need_more_daters' using errcode = 'P0001';
  end if;
  update public.live_streams set round_number = round_number + 1, round_started_at = now()
   where id = p_stream_id returning round_number into v_n;
  return v_n;
end;
$$;

-- like someone from a live. Targets: host / LIVE MATCH guest / daters on stage (anyone watching), and,
-- for the host / guest / daters, people who commented in this room.
create or replace function private.like_from_live(p_stream_id uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  s record;
  v_on_stage boolean;
  v_me_on_stage boolean;
  v_commented boolean;
  t record;
  v_match uuid;
  v_conv uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into s from public.live_streams where id = p_stream_id;
  if not found or s.started_at < now() - interval '1 day' then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) or private.is_hidden_user(v_uid) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if p_target is null or p_target = v_uid then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into t from public.profiles where id = p_target;
  if not found or t.hidden_at is not null or public.is_blocked_either_way(v_uid, p_target) then
    raise exception 'not_available' using errcode = 'P0001';
  end if;

  v_on_stage := p_target = s.host_id or p_target is not distinct from s.guest_id
    or exists (select 1 from public.live_participants lp where lp.stream_id = s.id and lp.user_id = p_target);
  v_me_on_stage := v_uid = s.host_id or v_uid is not distinct from s.guest_id
    or exists (select 1 from public.live_participants lp where lp.stream_id = s.id and lp.user_id = v_uid);
  v_commented := exists (select 1 from public.live_messages lm where lm.stream_id = s.id and lm.user_id = p_target)
    and not private.live_removed(s.id, p_target);
  if not (v_on_stage or (v_me_on_stage and v_commented)) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  -- incognito people stay invisible unless they're on stage or already liked you
  if t.incognito and not v_on_stage
     and not exists (select 1 from public.likes l where l.liker_id = p_target and l.liked_id = v_uid) then
    raise exception 'not_available' using errcode = 'P0001';
  end if;

  perform private.hit_rate_limit('live_like', 30, interval '1 minute');
  if not exists (select 1 from public.likes l where l.liker_id = v_uid and l.liked_id = p_target) then
    -- enforce_like_limits / try_create_match / notifications all run on this insert
    insert into public.likes (liker_id, liked_id) values (v_uid, p_target);
  end if;
  select m.id into v_match from public.matches m
   where m.user_a = least(v_uid, p_target) and m.user_b = greatest(v_uid, p_target);
  if v_match is not null then
    select c.id into v_conv from public.conversations c where c.match_id = v_match;
  end if;
  return jsonb_build_object('liked', true, 'matched', v_match is not null, 'match_id', v_match,
                            'conversation_id', v_conv, 'name', t.name);
end;
$$;

-- host-side list of people in the room (no location, ever). Incognito viewers only appear once they comment.
create or replace function private.live_people(p_stream_id uuid)
returns table (user_id uuid, name text, watching boolean, commented boolean, muted boolean, seated boolean,
               liked boolean, matched boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  select * into s from public.live_streams where id = p_stream_id;
  if not found or (v_uid is distinct from s.host_id and v_uid is distinct from s.guest_id) then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  return query
    with ppl as (
      select v.viewer_id as uid, true as w, false as c from public.live_viewers v
       where v.stream_id = s.id and v.last_seen_at > now() - interval '75 seconds'
      union all
      select lm.user_id, false, true from public.live_messages lm where lm.stream_id = s.id
    ), agg as (select ppl.uid, bool_or(ppl.w) w, bool_or(ppl.c) c from ppl group by ppl.uid)
    select a.uid, coalesce(p.name, 'Member'), a.w, a.c,
           exists (select 1 from public.live_moderation x where x.stream_id = s.id and x.user_id = a.uid and x.muted_at is not null),
           exists (select 1 from public.live_participants lp where lp.stream_id = s.id and lp.user_id = a.uid),
           exists (select 1 from public.likes l where l.liker_id = v_uid and l.liked_id = a.uid),
           exists (select 1 from public.matches m where m.user_a = least(v_uid, a.uid) and m.user_b = greatest(v_uid, a.uid))
      from agg a join public.profiles p on p.id = a.uid
     where a.uid not in (s.host_id, coalesce(s.guest_id, s.host_id))
       and p.hidden_at is null
       and not public.is_blocked_either_way(a.uid, v_uid)
       and not private.live_removed(s.id, a.uid)
       and (not p.incognito or a.c)
     order by a.c desc, a.w desc, p.name
     limit 200;
end;
$$;

create or replace function private.live_moderate(p_stream_id uuid, p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  select * into s from public.live_streams where id = p_stream_id;
  if not found or s.host_id is distinct from v_uid then raise exception 'not_host' using errcode = 'P0001'; end if;
  if p_user is null or p_user = s.host_id then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if p_action not in ('remove', 'mute', 'unmute', 'unseat') then raise exception 'invalid_action' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('live_moderate', 60, interval '1 minute');
  if p_action = 'remove' then
    insert into public.live_moderation (stream_id, user_id, removed_at) values (p_stream_id, p_user, now())
    on conflict (stream_id, user_id) do update set removed_at = now(), updated_at = now();
    delete from public.live_viewers where stream_id = p_stream_id and viewer_id = p_user;
    delete from public.live_participants where stream_id = p_stream_id and user_id = p_user;
    if s.guest_id = p_user then update public.live_streams set guest_id = null, is_live_match = false where id = p_stream_id; end if;
    update public.live_streams set pinned_message_id = null
     where id = p_stream_id and pinned_message_id in (select id from public.live_messages where user_id = p_user);
  elsif p_action = 'mute' then
    insert into public.live_moderation (stream_id, user_id, muted_at) values (p_stream_id, p_user, now())
    on conflict (stream_id, user_id) do update set muted_at = now(), updated_at = now();
  elsif p_action = 'unmute' then
    update public.live_moderation set muted_at = null, updated_at = now() where stream_id = p_stream_id and user_id = p_user;
  else
    delete from public.live_participants where stream_id = p_stream_id and user_id = p_user;
  end if;
end;
$$;

create or replace function private.live_set_comments_muted(p_stream_id uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.live_streams set comments_muted = coalesce(p_muted, false)
   where id = p_stream_id and host_id = (select auth.uid());
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;
end;
$$;

create or replace function private.live_pin_message(p_stream_id uuid, p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_message_id is not null and not exists (
       select 1 from public.live_messages lm where lm.id = p_message_id and lm.stream_id = p_stream_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('live_moderate', 60, interval '1 minute');
  update public.live_streams set pinned_message_id = p_message_id
   where id = p_stream_id and host_id = (select auth.uid());
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;
end;
$$;

------------------------------------------------------------------------------
-- public SECURITY INVOKER wrappers + grants
------------------------------------------------------------------------------
create or replace function public.get_live_eligibility()
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.live_eligibility(); $$;
create or replace function public.start_live(p_title text, p_category text, p_guest_id uuid default null,
                                             p_room_type text default 'standard', p_question text default null)
returns uuid language sql security invoker set search_path = '' as $$
  select private.start_live(p_title, p_category, p_guest_id, p_room_type, p_question); $$;
create or replace function public.get_live_rooms(p_category text default null)
returns table (id uuid, host_id uuid, host_name text, guest_id uuid, guest_name text, title text, category text,
               is_live_match boolean, started_at timestamptz, viewers integer, reactions integer, is_mine boolean,
               room_type text, question text, daters integer)
language sql stable security invoker set search_path = '' as $$ select * from private.live_rooms(p_category); $$;
create or replace function public.get_live_state(p_stream_id uuid)
returns table (status text, viewers integer, reactions integer, yes_votes integer, no_votes integer, my_vote boolean,
               room_type text, question text, comments_muted boolean, pinned jsonb,
               round_number integer, round_started_at timestamptz, round_ends_at timestamptz, round_pair uuid[],
               stage jsonb, my_status text, can_interact boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.live_state(p_stream_id); $$;
create or replace function public.live_take_seat(p_stream_id uuid)
returns integer language sql security invoker set search_path = '' as $$ select private.live_take_seat(p_stream_id); $$;
create or replace function public.live_leave_seat(p_stream_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.live_leave_seat(p_stream_id); $$;
create or replace function public.live_next_round(p_stream_id uuid)
returns integer language sql security invoker set search_path = '' as $$ select private.live_next_round(p_stream_id); $$;
create or replace function public.like_from_live(p_stream_id uuid, p_target uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.like_from_live(p_stream_id, p_target); $$;
create or replace function public.get_live_people(p_stream_id uuid)
returns table (user_id uuid, name text, watching boolean, commented boolean, muted boolean, seated boolean,
               liked boolean, matched boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.live_people(p_stream_id); $$;
create or replace function public.live_moderate(p_stream_id uuid, p_user uuid, p_action text)
returns void language sql security invoker set search_path = '' as $$ select private.live_moderate(p_stream_id, p_user, p_action); $$;
create or replace function public.live_set_comments_muted(p_stream_id uuid, p_muted boolean)
returns void language sql security invoker set search_path = '' as $$ select private.live_set_comments_muted(p_stream_id, p_muted); $$;
create or replace function public.live_pin_message(p_stream_id uuid, p_message_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.live_pin_message(p_stream_id, p_message_id); $$;

do $$
declare f text;
begin
  -- internal helpers: never callable directly
  foreach f in array array[
    'private.live_missing(uuid)', 'private.live_require_interact()', 'private.live_host_block(uuid)',
    'private.speed_pair_order(integer)', 'private.speed_lineup(uuid)', 'private.speed_round_pair(uuid)',
    'private.live_messages_before_insert()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- used inside RLS policies / invoker wrappers: callable by signed-in users only
  foreach f in array array[
    'private.live_can_see(uuid)', 'private.live_removed(uuid, uuid)', 'private.is_live_host(uuid)',
    'private.live_eligibility()', 'private.start_live(text, text, uuid, text, text)', 'private.join_live(uuid)',
    'private.leave_live(uuid)', 'private.live_rooms(text)', 'private.live_state(uuid)', 'private.live_token_grant(uuid)',
    'private.send_live_gift(uuid, text, integer)', 'private.live_take_seat(uuid)', 'private.live_leave_seat(uuid)',
    'private.live_next_round(uuid)', 'private.like_from_live(uuid, uuid)', 'private.live_people(uuid)',
    'private.live_moderate(uuid, uuid, text)', 'private.live_set_comments_muted(uuid, boolean)',
    'private.live_pin_message(uuid, uuid)',
    'public.get_live_eligibility()', 'public.start_live(text, text, uuid, text, text)', 'public.get_live_rooms(text)',
    'public.get_live_state(uuid)', 'public.live_take_seat(uuid)', 'public.live_leave_seat(uuid)',
    'public.live_next_round(uuid)', 'public.like_from_live(uuid, uuid)', 'public.get_live_people(uuid)',
    'public.live_moderate(uuid, uuid, text)', 'public.live_set_comments_muted(uuid, boolean)',
    'public.live_pin_message(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

------------------------------------------------------------------------------
-- housekeeping: drop stale stage seats too
------------------------------------------------------------------------------
select cron.unschedule('live-housekeeping') where exists (select 1 from cron.job where jobname = 'live-housekeeping');
select cron.schedule('live-housekeeping', '*/5 * * * *', $cron$
  update public.live_streams set ended_at = now()
   where ended_at is null and last_heartbeat_at < now() - interval '5 minutes';
  delete from public.live_viewers where last_seen_at < now() - interval '10 minutes';
  delete from public.live_participants where last_seen_at < now() - interval '10 minutes';
  delete from private.rate_limits where window_start < now() - interval '2 days';
$cron$);
