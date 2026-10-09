-- Group dating rooms (up to 10 people, everyone on camera).
--  Modes: 'roulette'  — join a room of people who match your preferences (gender both ways, age, distance)
--         'interests' — one room per interest tag
--         'friends'   — a host invites selected matches; the host starts the room
--  Lifecycle: open → live (group_live_minutes) → picking (group_pick_seconds) → done.
--  At the end each person privately picks who they liked; mutual picks become matches
--  (likes inserted with match.like_source='speed', so daily like limits don't eat them).
--  Free to use. Blocks keep people apart; incognito people can only use Friends rooms.
--  Tables have no client grants; everything goes through SECURITY DEFINER RPCs.

insert into public.app_settings (key, value, description) values
  ('group_max_members', '10', 'Group dating: people per room'),
  ('group_min_members', '3', 'Group dating: people needed before a roulette / interests room goes live'),
  ('group_live_minutes', '10', 'Group dating: minutes on camera before picks'),
  ('group_pick_seconds', '120', 'Group dating: seconds to make private picks'),
  ('group_open_minutes', '10', 'Group dating: an open room that never fills is closed after this many minutes')
on conflict (key) do nothing;

create table if not exists public.group_rooms (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('roulette', 'friends', 'interests')),
  host_id uuid references public.profiles(id) on delete set null,
  interest_id integer references public.interests(id) on delete set null,
  title text not null check (char_length(title) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'live', 'picking', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz,
  picks_until timestamptz,
  ended_reason text,
  matches_made integer not null default 0
);
create index if not exists group_rooms_active_idx on public.group_rooms (mode, status) where status in ('open', 'live', 'picking');
create index if not exists group_rooms_host_idx on public.group_rooms (host_id);
create index if not exists group_rooms_interest_idx on public.group_rooms (interest_id);

create table if not exists public.group_members (
  room_id uuid not null references public.group_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  min_age integer not null default 18,
  max_age integer not null default 99,
  max_km integer,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  picks_done_at timestamptz,
  primary key (room_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

create table if not exists public.group_invites (
  room_id uuid not null references public.group_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists group_invites_user_idx on public.group_invites (user_id);
create index if not exists group_invites_by_idx on public.group_invites (invited_by);

create table if not exists public.group_picks (
  room_id uuid not null references public.group_rooms(id) on delete cascade,
  picker_id uuid not null references public.profiles(id) on delete cascade,
  picked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, picker_id, picked_id),
  check (picker_id <> picked_id)
);
create index if not exists group_picks_picked_idx on public.group_picks (picked_id);
create index if not exists group_picks_picker_idx on public.group_picks (picker_id);

do $$
declare t text;
begin
  foreach t in array array['group_rooms', 'group_members', 'group_invites', 'group_picks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- helpers
create or replace function private.group_active_count(p_room uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.group_members m
   where m.room_id = p_room and m.left_at is null and m.last_seen_at > now() - interval '60 seconds';
$$;

/** Mutual gender prefs + both age ranges + distance; no blocks; nobody hidden. */
create or replace function private.group_compatible(a public.group_members, b public.group_members)
returns boolean language sql stable security definer set search_path = '' as $$
  select a.user_id <> b.user_id
     and pa.hidden_at is null and pb.hidden_at is null
     and not public.is_blocked_either_way(a.user_id, b.user_id)
     and private.pref_accepts(pa.interested_in, pb.gender) and private.pref_accepts(pb.interested_in, pa.gender)
     and pb.birth_date <= (current_date - make_interval(years => a.min_age))::date
     and pb.birth_date > (current_date - make_interval(years => a.max_age + 1))::date
     and pa.birth_date <= (current_date - make_interval(years => b.min_age))::date
     and pa.birth_date > (current_date - make_interval(years => b.max_age + 1))::date
     and (coalesce(a.max_km, b.max_km) is null or la.cell_lat is null or lb.cell_lat is null
          or private.km_between(la.cell_lat, la.cell_lng, lb.cell_lat, lb.cell_lng)
             <= least(coalesce(a.max_km, 100000), coalesce(b.max_km, 100000)))
  from public.profiles pa, public.profiles pb
  left join private.user_locations lb on lb.user_id = pb.id
  left join private.user_locations la on la.user_id = a.user_id
  where pa.id = a.user_id and pb.id = b.user_id;
$$;

/** Is anyone currently in the room blocked with p_user (either way)? */
create or replace function private.group_blocked_with_member(p_room uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m
                  where m.room_id = p_room and m.user_id <> p_user and m.left_at is null
                    and public.is_blocked_either_way(m.user_id, p_user));
$$;

/** Mutual picks → likes (limit bypass) → matches. Idempotent. */
create or replace function private.group_finalize(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  perform set_config('match.like_source', 'speed', true);
  for r in
    select a.picker_id as x, a.picked_id as y from public.group_picks a
      join public.group_picks b on b.room_id = a.room_id and b.picker_id = a.picked_id and b.picked_id = a.picker_id
     where a.room_id = p_room and a.picker_id < a.picked_id
  loop
    if not public.is_blocked_either_way(r.x, r.y) and not private.is_hidden_user(r.x) and not private.is_hidden_user(r.y) then
      insert into public.likes (liker_id, liked_id) values (r.x, r.y) on conflict do nothing;
      insert into public.likes (liker_id, liked_id) values (r.y, r.x) on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  perform set_config('match.like_source', '', true);
  update public.group_rooms set status = 'done', matches_made = v_n,
         ended_reason = coalesce(ended_reason, 'completed') where id = p_room;
end;
$$;

/** Advance one room by the clock. */
create or replace function private.group_tick(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.group_rooms; v_active integer;
begin
  select * into r from public.group_rooms where id = p_room for update;
  if not found or r.status in ('done', 'cancelled') then return; end if;
  v_active := private.group_active_count(p_room);
  if r.status = 'open' then
    if r.mode <> 'friends' and v_active >= private.setting_num('group_min_members', 3) then
      update public.group_rooms set status = 'live', started_at = now(),
             ends_at = now() + make_interval(mins => private.setting_num('group_live_minutes', 10)::integer)
       where id = p_room;
    elsif r.created_at < now() - make_interval(mins => private.setting_num('group_open_minutes', 10)::integer
                                                     * case when r.mode = 'friends' then 3 else 1 end)
          or v_active = 0 then
      update public.group_rooms set status = 'cancelled', ended_reason = 'not_enough_people' where id = p_room;
    end if;
  elsif r.status = 'live' then
    if now() >= r.ends_at or v_active < 2 then
      update public.group_rooms set status = 'picking', ends_at = least(ends_at, now()),
             picks_until = now() + make_interval(secs => private.setting_num('group_pick_seconds', 120)::integer)
       where id = p_room;
    end if;
  elsif r.status = 'picking' then
    if now() >= r.picks_until
       or not exists (select 1 from public.group_members m
                       where m.room_id = p_room and m.picks_done_at is null and m.left_at is null) then
      perform private.group_finalize(p_room);
    end if;
  end if;
end;
$$;

create or replace function private.group_room_json(p_room uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.group_rooms; me public.group_members; v_members jsonb; v_matches jsonb; v_invites jsonb;
begin
  select * into r from public.group_rooms where id = p_room;
  if not found then return null; end if;
  select * into me from public.group_members where room_id = p_room and user_id = p_uid;
  if not found and r.host_id is distinct from p_uid then return null; end if;
  -- people: during open/live only those still here; for picks everyone who was in the room
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', coalesce(p.name, 'Member'), 'age', private.age_anchor(p.birth_date),
           'photo', (select ph.url from public.photos ph where ph.user_id = p.id order by ph.is_primary desc, ph.position limit 1),
           'verified', coalesce(p.verified, false), 'intention', p.intention,
           'is_me', p.id = p_uid, 'is_host', p.id = r.host_id,
           'here', m.left_at is null and m.last_seen_at > now() - interval '60 seconds',
           'picked', exists (select 1 from public.group_picks gp where gp.room_id = p_room and gp.picker_id = p_uid and gp.picked_id = p.id),
           'matched', p.id <> p_uid and exists (select 1 from public.matches mm where mm.user_a = least(p.id, p_uid) and mm.user_b = greatest(p.id, p_uid)))
           order by m.joined_at), '[]'::jsonb)
    into v_members
    from public.group_members m join public.profiles p on p.id = m.user_id
   where m.room_id = p_room and p.hidden_at is null
     and (p.id = p_uid or not public.is_blocked_either_way(p.id, p_uid))
     and (r.status in ('picking', 'done') or m.left_at is null);
  -- the outcome is only ever "your mutual picks" — never who picked you one-sidedly
  if r.status = 'done' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(p.name, 'Member'),
             'photo', (select ph.url from public.photos ph where ph.user_id = p.id order by ph.is_primary desc, ph.position limit 1),
             'match_id', mm.id, 'conversation_id', (select c.id from public.conversations c where c.match_id = mm.id))), '[]'::jsonb)
      into v_matches
      from public.group_picks a
      join public.group_picks b on b.room_id = a.room_id and b.picker_id = a.picked_id and b.picked_id = a.picker_id
      join public.profiles p on p.id = a.picked_id
      left join public.matches mm on mm.user_a = least(a.picker_id, a.picked_id) and mm.user_b = greatest(a.picker_id, a.picked_id)
     where a.room_id = p_room and a.picker_id = p_uid and not public.is_blocked_either_way(p_uid, p.id);
  end if;
  if r.host_id = p_uid and r.mode = 'friends' then
    select coalesce(jsonb_agg(jsonb_build_object('id', i.user_id, 'name', coalesce(p.name, 'Member'), 'status', i.status)
                              order by i.created_at), '[]'::jsonb)
      into v_invites
      from public.group_invites i join public.profiles p on p.id = i.user_id where i.room_id = p_room;
  end if;
  return jsonb_build_object(
    'id', r.id, 'mode', r.mode, 'title', r.title, 'status', r.status, 'ended_reason', r.ended_reason,
    'interest', (select jsonb_build_object('id', i.id, 'label', i.label, 'category', i.category) from public.interests i where i.id = r.interest_id),
    'is_host', r.host_id = p_uid, 'created_at', r.created_at, 'started_at', r.started_at, 'ends_at', r.ends_at,
    'picks_until', r.picks_until, 'max', private.setting_num('group_max_members', 10)::integer,
    'min', case when r.mode = 'friends' then 2 else private.setting_num('group_min_members', 3)::integer end,
    'here', private.group_active_count(p_room),
    'members', v_members, 'picks_done', me.picks_done_at is not null, 'left', me.left_at is not null,
    'matches', v_matches, 'invites', v_invites);
end;
$$;

create or replace function private.group_current_room(p_uid uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.group_rooms r join public.group_members m on m.room_id = r.id and m.user_id = p_uid
   where r.status in ('open', 'live', 'picking') and (m.left_at is null or r.status = 'picking')
   order by r.created_at desc limit 1;
$$;

create or replace function private.group_require(p_uid uuid, p_mode text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_block text := private.speed_eligible_block(p_uid);
begin
  if p_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if v_block = 'incognito_speed' and p_mode = 'friends' then v_block := null; end if;
  if v_block = 'profile_incomplete' then
    raise exception 'profile_incomplete' using errcode = 'P0001', detail = array_to_string(private.live_missing(p_uid), ',');
  elsif v_block = 'incognito_speed' then
    raise exception 'incognito_group' using errcode = 'P0001';
  elsif v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- public API bodies
create or replace function private.group_lobby()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_room uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  v_room := private.group_current_room(v_uid);
  if v_room is not null then perform private.group_tick(v_room); v_room := private.group_current_room(v_uid); end if;
  return jsonb_build_object(
    'current', case when v_room is null then null else private.group_room_json(v_room, v_uid) end,
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('room_id', r.id, 'title', r.title,
                                  'host', jsonb_build_object('id', h.id, 'name', coalesce(h.name, 'Member'),
                                    'photo', (select ph.url from public.photos ph where ph.user_id = h.id order by ph.is_primary desc, ph.position limit 1)),
                                  'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
                  from public.group_invites i join public.group_rooms r on r.id = i.room_id
                  join public.profiles h on h.id = r.host_id
                 where i.user_id = v_uid and i.status = 'pending' and r.status in ('open', 'live')
                   and not public.is_blocked_either_way(v_uid, h.id) and h.hidden_at is null),
    'interest_rooms', (select coalesce(jsonb_agg(x order by x->>'here' desc), '[]'::jsonb) from (
        select jsonb_build_object('room_id', r.id, 'interest_id', r.interest_id, 'label', i.label, 'status', r.status,
                                  'here', private.group_active_count(r.id), 'mine', exists (
                                    select 1 from public.user_interests ui where ui.user_id = v_uid and ui.interest_id = r.interest_id)) x
          from public.group_rooms r join public.interests i on i.id = r.interest_id
         where r.mode = 'interests' and r.status in ('open', 'live')
           and private.group_active_count(r.id) between 1 and private.setting_num('group_max_members', 10) - 1
           and not private.group_blocked_with_member(r.id, v_uid)
         limit 30) s),
    'my_interests', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label) order by i.label), '[]'::jsonb)
                       from public.user_interests ui join public.interests i on i.id = ui.interest_id where ui.user_id = v_uid),
    'block', private.speed_eligible_block(v_uid),
    'missing', to_jsonb(private.live_missing(v_uid)),
    'max', private.setting_num('group_max_members', 10)::integer,
    'live_minutes', private.setting_num('group_live_minutes', 10)::integer);
end;
$$;

create or replace function private.group_join(p_mode text, p_interest integer default null,
                                              p_min_age integer default 18, p_max_age integer default 99,
                                              p_max_km integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.group_members;
  v_room uuid;
  v_label text;
  v_max integer := private.setting_num('group_max_members', 10)::integer;
  c record;
begin
  if p_mode not in ('roulette', 'interests') then raise exception 'invalid_mode' using errcode = 'P0001'; end if;
  perform private.group_require(v_uid, p_mode);
  if p_min_age is null or p_max_age is null or p_min_age < 18 or p_max_age > 99 or p_min_age > p_max_age
     or (p_max_km is not null and (p_max_km < 1 or p_max_km > 500)) then
    raise exception 'invalid_preferences' using errcode = 'P0001';
  end if;
  if p_mode = 'interests' then
    select label into v_label from public.interests where id = p_interest;
    if v_label is null then raise exception 'invalid_interest' using errcode = 'P0001'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('group_join'));
  v_room := private.group_current_room(v_uid);
  if v_room is not null then
    raise exception 'already_in_room' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('group_join', 30, interval '1 hour');
  me.user_id := v_uid; me.min_age := p_min_age; me.max_age := p_max_age; me.max_km := p_max_km;

  -- the fullest open/live room where nobody is blocked with me and (roulette) someone matches my preferences
  for c in
    select r.id from public.group_rooms r
     where r.mode = p_mode and r.status in ('open', 'live')
       and (p_mode <> 'interests' or r.interest_id = p_interest)
       and (r.status = 'open' or r.ends_at > now() + interval '2 minutes')
       and private.group_active_count(r.id) < v_max
       and not private.group_blocked_with_member(r.id, v_uid)
       and not exists (select 1 from public.group_members x where x.room_id = r.id and x.user_id = v_uid)
     order by private.group_active_count(r.id) desc, r.created_at
     limit 20
  loop
    if p_mode = 'interests' or exists (
         select 1 from public.group_members m
          where m.room_id = c.id and m.left_at is null and m.last_seen_at > now() - interval '60 seconds'
            and private.group_compatible(me, m)) then
      v_room := c.id;
      exit;
    end if;
  end loop;
  if v_room is null then
    insert into public.group_rooms (mode, interest_id, title)
    values (p_mode, case when p_mode = 'interests' then p_interest end,
            case when p_mode = 'interests' then left(v_label || ' lovers', 60) else 'Roulette room' end)
    returning id into v_room;
  end if;
  insert into public.group_members (room_id, user_id, min_age, max_age, max_km)
  values (v_room, v_uid, p_min_age, p_max_age, p_max_km);
  perform private.group_tick(v_room);
  return private.group_room_json(v_room, v_uid);
end;
$$;

create or replace function private.group_create_friends(p_title text, p_invitees uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_room uuid;
  v_ok uuid[];
  v_max integer := private.setting_num('group_max_members', 10)::integer;
begin
  perform private.group_require(v_uid, 'friends');
  if private.group_current_room(v_uid) is not null then raise exception 'already_in_room' using errcode = 'P0001'; end if;
  if p_invitees is null or cardinality(p_invitees) = 0 then raise exception 'no_invitees' using errcode = 'P0001'; end if;
  if cardinality(p_invitees) > v_max - 1 then raise exception 'too_many_invitees' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('group_friends', 10, interval '1 day');
  -- only your matches; blocked / hidden people silently dropped
  select array_agg(distinct u) into v_ok from unnest(p_invitees) u
   where u <> v_uid and not public.is_blocked_either_way(u, v_uid) and not private.is_hidden_user(u)
     and exists (select 1 from public.matches m where m.user_a = least(u, v_uid) and m.user_b = greatest(u, v_uid));
  if v_ok is null then raise exception 'no_invitees' using errcode = 'P0001'; end if;
  insert into public.group_rooms (mode, host_id, title)
  values ('friends', v_uid, left(coalesce(nullif(btrim(p_title), ''), 'Friends group date'), 60))
  returning id into v_room;
  insert into public.group_members (room_id, user_id) values (v_room, v_uid);
  insert into public.group_invites (room_id, user_id, invited_by) select v_room, u, v_uid from unnest(v_ok) u;
  insert into public.notifications (user_id, actor_id, type, payload)
  select u, v_uid, 'live_invite', jsonb_build_object('room_id', v_room, 'mode', 'friends') from unnest(v_ok) u;
  return private.group_room_json(v_room, v_uid) || jsonb_build_object('invited', to_jsonb(v_ok));
end;
$$;

create or replace function private.group_respond_invite(p_room uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r public.group_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('group_join'));
  select * into r from public.group_rooms where id = p_room;
  if not found or not exists (select 1 from public.group_invites i where i.room_id = p_room and i.user_id = v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if not coalesce(p_accept, false) then
    update public.group_invites set status = 'declined' where room_id = p_room and user_id = v_uid;
    return jsonb_build_object('declined', true);
  end if;
  perform private.group_require(v_uid, 'friends');
  if r.status not in ('open', 'live') then raise exception 'room_closed' using errcode = 'P0001'; end if;
  if public.is_blocked_either_way(v_uid, r.host_id) or private.group_blocked_with_member(p_room, v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_members where room_id = p_room and user_id = v_uid) then
    update public.group_members set left_at = null, last_seen_at = now() where room_id = p_room and user_id = v_uid;
  else
    if private.group_current_room(v_uid) is not null then raise exception 'already_in_room' using errcode = 'P0001'; end if;
    if private.group_active_count(p_room) >= private.setting_num('group_max_members', 10) then
      raise exception 'room_full' using errcode = 'P0001';
    end if;
    insert into public.group_members (room_id, user_id) values (p_room, v_uid);
  end if;
  update public.group_invites set status = 'accepted' where room_id = p_room and user_id = v_uid;
  return private.group_room_json(p_room, v_uid);
end;
$$;

create or replace function private.group_start(p_room uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r public.group_rooms;
begin
  select * into r from public.group_rooms where id = p_room for update;
  if not found or r.host_id is distinct from v_uid then raise exception 'not_host' using errcode = 'P0001'; end if;
  if r.status <> 'open' then return private.group_room_json(p_room, v_uid); end if;
  if private.group_active_count(p_room) < 2 then raise exception 'need_more_people' using errcode = 'P0001'; end if;
  update public.group_rooms set status = 'live', started_at = now(),
         ends_at = now() + make_interval(mins => private.setting_num('group_live_minutes', 10)::integer)
   where id = p_room;
  return private.group_room_json(p_room, v_uid);
end;
$$;

create or replace function private.group_status(p_room uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.group_members where room_id = p_room and user_id = v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  update public.group_members set last_seen_at = now() where room_id = p_room and user_id = v_uid and left_at is null;
  perform private.group_tick(p_room);
  return private.group_room_json(p_room, v_uid);
end;
$$;

create or replace function private.group_leave(p_room uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r public.group_rooms;
begin
  select * into r from public.group_rooms where id = p_room for update;
  if not found or not exists (select 1 from public.group_members where room_id = p_room and user_id = v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  update public.group_members set left_at = coalesce(left_at, now()) where room_id = p_room and user_id = v_uid;
  if r.status = 'open' and r.host_id = v_uid then
    update public.group_rooms set status = 'cancelled', ended_reason = 'host_left' where id = p_room;
  end if;
  perform private.group_tick(p_room);
  return private.group_room_json(p_room, v_uid);
end;
$$;

/** Private picks at the end of the room. Replaces your previous picks; only people who were in the room. */
create or replace function private.group_pick(p_room uuid, p_picked uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r public.group_rooms;
begin
  perform private.hit_rate_limit('group_pick', 30, interval '1 minute');
  perform private.group_tick(p_room);
  select * into r from public.group_rooms where id = p_room;
  if not found or not exists (select 1 from public.group_members where room_id = p_room and user_id = v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if r.status <> 'picking' then raise exception 'not_picking' using errcode = 'P0001'; end if;
  delete from public.group_picks where room_id = p_room and picker_id = v_uid;
  insert into public.group_picks (room_id, picker_id, picked_id)
  select p_room, v_uid, u from unnest(coalesce(p_picked, '{}')) u
   where u <> v_uid and exists (select 1 from public.group_members m where m.room_id = p_room and m.user_id = u)
     and not public.is_blocked_either_way(u, v_uid)
  on conflict do nothing;
  update public.group_members set picks_done_at = now() where room_id = p_room and user_id = v_uid;
  perform private.group_tick(p_room);
  return private.group_room_json(p_room, v_uid);
end;
$$;

create or replace function private.get_group_token_grant(p_room uuid)
returns table (room text, identity uuid, display_name text, can_publish boolean, kind text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); r public.group_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('group_token', 30, interval '1 minute');
  perform private.group_tick(p_room);
  select * into r from public.group_rooms where id = p_room;
  if not found or not exists (select 1 from public.group_members m where m.room_id = p_room and m.user_id = v_uid and m.left_at is null) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if r.status not in ('open', 'live') then raise exception 'call_ended' using errcode = 'P0001'; end if;
  return query select 'group_' || r.id::text, v_uid, (select coalesce(p.name, 'Member') from public.profiles p where p.id = v_uid), true, 'video'::text;
end;
$$;

create or replace function private.group_housekeeping()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.group_rooms where status in ('open', 'live', 'picking') loop
    perform private.group_tick(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants + wrappers
do $$
declare f text;
begin
  foreach f in array array[
    'private.group_active_count(uuid)', 'private.group_compatible(public.group_members, public.group_members)',
    'private.group_blocked_with_member(uuid, uuid)', 'private.group_finalize(uuid)', 'private.group_tick(uuid)',
    'private.group_room_json(uuid, uuid)', 'private.group_current_room(uuid)', 'private.group_require(uuid, text)',
    'private.group_housekeeping()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'private.group_lobby()', 'private.group_join(text, integer, integer, integer, integer)',
    'private.group_create_friends(text, uuid[])', 'private.group_respond_invite(uuid, boolean)',
    'private.group_start(uuid)', 'private.group_status(uuid)', 'private.group_leave(uuid)',
    'private.group_pick(uuid, uuid[])', 'private.get_group_token_grant(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

create or replace function public.group_lobby() returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_lobby() $$;
create or replace function public.group_join(p_mode text, p_interest integer default null, p_min_age integer default 18,
                                             p_max_age integer default 99, p_max_km integer default null) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_join(p_mode, p_interest, p_min_age, p_max_age, p_max_km) $$;
create or replace function public.group_create_friends(p_title text, p_invitees uuid[]) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_create_friends(p_title, p_invitees) $$;
create or replace function public.group_respond_invite(p_room uuid, p_accept boolean) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_respond_invite(p_room, p_accept) $$;
create or replace function public.group_start(p_room uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_start(p_room) $$;
create or replace function public.group_status(p_room uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_status(p_room) $$;
create or replace function public.group_leave(p_room uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_leave(p_room) $$;
create or replace function public.group_pick(p_room uuid, p_picked uuid[]) returns jsonb
language sql security invoker set search_path = '' as $$ select private.group_pick(p_room, p_picked) $$;
create or replace function public.get_group_token_grant(p_room uuid)
returns table (room text, identity uuid, display_name text, can_publish boolean, kind text)
language sql security invoker set search_path = '' as $$ select * from private.get_group_token_grant(p_room) $$;

do $$
declare f text;
begin
  foreach f in array array['public.group_lobby()', 'public.group_join(text, integer, integer, integer, integer)',
    'public.group_create_friends(text, uuid[])', 'public.group_respond_invite(uuid, boolean)', 'public.group_start(uuid)',
    'public.group_status(uuid)', 'public.group_leave(uuid)', 'public.group_pick(uuid, uuid[])',
    'public.get_group_token_grant(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- cron: piggyback on the per-minute speed sweep
select cron.unschedule('speed-housekeeping') where exists (select 1 from cron.job where jobname = 'speed-housekeeping');
select cron.schedule('speed-housekeeping', '* * * * *', $cron$ select private.speed_housekeeping(); select private.group_housekeeping(); $cron$);
