-- Live rooms, server-backed: go live / end / heartbeat, viewer presence + counts,
-- room chat, reactions, LIVE MATCH votes, LiveKit token grants.
-- Also introduces the generic server-side rate limiter used by later hardening.

------------------------------------------------------------------------------
-- 0. generic fixed-window rate limiter
------------------------------------------------------------------------------
create table if not exists private.rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, action, window_start)
);
alter table private.rate_limits enable row level security;
drop policy if exists "no direct access" on private.rate_limits;
create policy "no direct access" on private.rate_limits as restrictive for all to public using (false) with check (false);

create or replace function private.hit_rate_limit(p_action text, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_secs double precision := extract(epoch from p_window);
  v_start timestamptz;
  v_hits integer;
begin
  -- service_role / cron / definer-internal writes have no auth.uid(): not limited
  if v_uid is null then return; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / v_secs) * v_secs);
  insert into private.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, p_action, v_start, 1)
  on conflict (user_id, action, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > p_max then
    raise exception 'rate_limited' using errcode = 'P0001', detail = p_action;
  end if;
end;
$$;
revoke all on function private.hit_rate_limit(text, integer, interval) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 1. tables
------------------------------------------------------------------------------
alter table public.live_streams
  add column if not exists last_heartbeat_at timestamptz not null default now(),
  add column if not exists reaction_count integer not null default 0;
alter table public.live_streams drop constraint if exists live_streams_shape_check;
alter table public.live_streams add constraint live_streams_shape_check check (
  char_length(title) between 1 and 80
  and category = any (array['Dating','Music','Entertainment','Talk','Gaming'])
  and (guest_id is null or guest_id <> host_id)
  and (not is_live_match or guest_id is not null)
  and reaction_count >= 0
);
create index if not exists live_streams_active_idx on public.live_streams (last_heartbeat_at) where ended_at is null;
create unique index if not exists live_streams_one_active_per_host on public.live_streams (host_id) where ended_at is null;

alter table public.live_viewers add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.live_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists live_messages_stream_idx on public.live_messages (stream_id, created_at);
alter table public.live_messages enable row level security;

create table if not exists public.live_match_votes (
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  voter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  vote boolean not null,
  created_at timestamptz not null default now(),
  primary key (stream_id, voter_id)
);
alter table public.live_match_votes enable row level security;

------------------------------------------------------------------------------
-- 2. helpers
------------------------------------------------------------------------------
create or replace function private.live_is_active(p_stream_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.live_streams s
                 where s.id = p_stream_id and s.ended_at is null
                   and s.last_heartbeat_at > now() - interval '2 minutes');
$$;

-- can the caller see / join this stream (host or guest blocked either way → no)
create or replace function private.live_can_see(p_stream_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_streams s
    where s.id = p_stream_id
      and (select auth.uid()) is not null
      and not public.is_blocked_either_way(s.host_id, (select auth.uid()))
      and (s.guest_id is null or not public.is_blocked_either_way(s.guest_id, (select auth.uid())))
  );
$$;

------------------------------------------------------------------------------
-- 3. RLS: streams / viewers are written only through RPCs
------------------------------------------------------------------------------
drop policy if exists "hosts manage only their own stream" on public.live_streams;
drop policy if exists "live streams are viewable by authenticated users" on public.live_streams;
create policy "live streams visible unless blocked" on public.live_streams for select to authenticated
  using (private.live_can_see(id));
revoke insert, update, delete, truncate on public.live_streams from anon, authenticated;

drop policy if exists "users can join only as themselves" on public.live_viewers;
drop policy if exists "viewers are visible to authenticated users" on public.live_viewers;
create policy "viewers see their own presence" on public.live_viewers for select to authenticated
  using (viewer_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.live_viewers from anon, authenticated;

create policy "room chat visible to permitted viewers" on public.live_messages for select to authenticated
  using (private.live_can_see(stream_id) and not private.blocked_with_me(user_id));
create policy "viewers chat as themselves in active rooms" on public.live_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and private.live_is_active(stream_id) and private.live_can_see(stream_id));
create policy "authors delete their chat lines" on public.live_messages for delete to authenticated
  using (user_id = (select auth.uid()));
revoke update, truncate on public.live_messages from anon, authenticated;
revoke all on public.live_messages from anon;

create policy "voters see their own vote" on public.live_match_votes for select to authenticated
  using (voter_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.live_match_votes from anon, authenticated;
revoke all on public.live_match_votes from anon;

create or replace function private.live_messages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := (select auth.uid());
  new.body := btrim(new.body);
  new.created_at := now();
  perform private.hit_rate_limit('live_message', 20, interval '1 minute');
  return new;
end;
$$;
revoke all on function private.live_messages_before_insert() from public, anon, authenticated;
drop trigger if exists live_messages_before_insert on public.live_messages;
create trigger live_messages_before_insert before insert on public.live_messages
  for each row execute function private.live_messages_before_insert();

------------------------------------------------------------------------------
-- 4. RPC bodies
------------------------------------------------------------------------------
create or replace function private.start_live(p_title text, p_category text, p_guest_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('go_live', 10, interval '1 day');
  if p_guest_id is not null then
    if p_guest_id = v_uid
       or public.is_blocked_either_way(p_guest_id, v_uid)
       or not exists (select 1 from public.matches m
                      where (m.user_a = v_uid and m.user_b = p_guest_id) or (m.user_b = v_uid and m.user_a = p_guest_id)) then
      raise exception 'guest_not_allowed' using errcode = 'P0001';
    end if;
  end if;
  update public.live_streams set ended_at = now() where host_id = v_uid and ended_at is null;
  insert into public.live_streams (host_id, guest_id, title, category, is_live_match, started_at, last_heartbeat_at)
  values (v_uid, p_guest_id, left(btrim(coalesce(nullif(btrim(p_title), ''), 'Untitled live')), 80),
          coalesce(p_category, 'Talk'), p_guest_id is not null, now(), now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.end_live(p_stream_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.live_streams set ended_at = now()
  where id = p_stream_id and host_id = (select auth.uid()) and ended_at is null;
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;
  delete from public.live_viewers where stream_id = p_stream_id;
end;
$$;

-- join + heartbeat (call every ~30s). Host/guest keep the stream alive; viewers keep presence.
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
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  insert into public.live_viewers (stream_id, viewer_id, joined_at, last_seen_at)
  values (p_stream_id, v_uid, now(), now())
  on conflict (stream_id, viewer_id) do update set last_seen_at = now();
  return 'viewer';
end;
$$;

create or replace function private.leave_live(p_stream_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.live_viewers where stream_id = p_stream_id and viewer_id = (select auth.uid());
$$;

create or replace function private.live_rooms(p_category text default null)
returns table (id uuid, host_id uuid, host_name text, guest_id uuid, guest_name text, title text, category text,
               is_live_match boolean, started_at timestamptz, viewers integer, reactions integer, is_mine boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.host_id, h.name, s.guest_id, g.name, s.title, s.category, s.is_live_match, s.started_at,
         (select count(*) from public.live_viewers v
           where v.stream_id = s.id and v.last_seen_at > now() - interval '75 seconds')::integer,
         s.reaction_count, s.host_id = (select auth.uid())
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

create or replace function private.live_state(p_stream_id uuid)
returns table (status text, viewers integer, reactions integer, yes_votes integer, no_votes integer, my_vote boolean)
language sql stable security definer set search_path = '' as $$
  select case when s.ended_at is null and s.last_heartbeat_at > now() - interval '2 minutes' then 'live' else 'ended' end,
         (select count(*) from public.live_viewers v where v.stream_id = s.id and v.last_seen_at > now() - interval '75 seconds')::integer,
         s.reaction_count,
         (select count(*) from public.live_match_votes x where x.stream_id = s.id and x.vote)::integer,
         (select count(*) from public.live_match_votes x where x.stream_id = s.id and not x.vote)::integer,
         (select x.vote from public.live_match_votes x where x.stream_id = s.id and x.voter_id = (select auth.uid()))
  from public.live_streams s
  where s.id = p_stream_id and private.live_can_see(s.id);
$$;

create or replace function private.send_live_reaction(p_stream_id uuid, p_count integer default 1)
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  if not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('live_reaction', 60, interval '1 minute');
  update public.live_streams set reaction_count = reaction_count + greatest(1, least(coalesce(p_count, 1), 20))
  where id = p_stream_id returning reaction_count into v;
  return v;
end;
$$;

create or replace function private.vote_live_match(p_stream_id uuid, p_yes boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s record;
begin
  select * into s from public.live_streams where id = p_stream_id;
  if not found or not s.is_live_match then raise exception 'not_live_match' using errcode = 'P0001'; end if;
  if not private.live_is_active(p_stream_id) then raise exception 'stream_ended' using errcode = 'P0001'; end if;
  if not private.live_can_see(p_stream_id) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if v_uid in (s.host_id, s.guest_id) then raise exception 'cannot_vote_own' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('live_vote', 30, interval '1 minute');
  insert into public.live_match_votes (stream_id, voter_id, vote) values (p_stream_id, v_uid, p_yes)
  on conflict (stream_id, voter_id) do update set vote = excluded.vote, created_at = now();
end;
$$;

-- what the livekit-token Edge Function may grant (called with the user's JWT)
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
           v_uid in (s.host_id, s.guest_id);
end;
$$;

------------------------------------------------------------------------------
-- 5. public SECURITY INVOKER wrappers + grants
------------------------------------------------------------------------------
create or replace function public.start_live(p_title text, p_category text, p_guest_id uuid default null)
returns uuid language sql security invoker set search_path = '' as $$ select private.start_live(p_title, p_category, p_guest_id); $$;
create or replace function public.end_live(p_stream_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.end_live(p_stream_id); $$;
create or replace function public.join_live(p_stream_id uuid)
returns text language sql security invoker set search_path = '' as $$ select private.join_live(p_stream_id); $$;
create or replace function public.leave_live(p_stream_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.leave_live(p_stream_id); $$;
create or replace function public.get_live_rooms(p_category text default null)
returns table (id uuid, host_id uuid, host_name text, guest_id uuid, guest_name text, title text, category text,
               is_live_match boolean, started_at timestamptz, viewers integer, reactions integer, is_mine boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.live_rooms(p_category); $$;
create or replace function public.get_live_state(p_stream_id uuid)
returns table (status text, viewers integer, reactions integer, yes_votes integer, no_votes integer, my_vote boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.live_state(p_stream_id); $$;
create or replace function public.send_live_reaction(p_stream_id uuid, p_count integer default 1)
returns integer language sql security invoker set search_path = '' as $$ select private.send_live_reaction(p_stream_id, p_count); $$;
create or replace function public.vote_live_match(p_stream_id uuid, p_yes boolean)
returns void language sql security invoker set search_path = '' as $$ select private.vote_live_match(p_stream_id, p_yes); $$;
create or replace function public.get_live_token_grant(p_stream_id uuid)
returns table (room text, identity text, display_name text, can_publish boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.live_token_grant(p_stream_id); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.live_is_active(uuid)', 'private.live_can_see(uuid)',
    'private.start_live(text, text, uuid)', 'private.end_live(uuid)', 'private.join_live(uuid)',
    'private.leave_live(uuid)', 'private.live_rooms(text)', 'private.live_state(uuid)',
    'private.send_live_reaction(uuid, integer)', 'private.vote_live_match(uuid, boolean)',
    'private.live_token_grant(uuid)',
    'public.start_live(text, text, uuid)', 'public.end_live(uuid)', 'public.join_live(uuid)',
    'public.leave_live(uuid)', 'public.get_live_rooms(text)', 'public.get_live_state(uuid)',
    'public.send_live_reaction(uuid, integer)', 'public.vote_live_match(uuid, boolean)',
    'public.get_live_token_grant(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 6. realtime + housekeeping
------------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.live_messages;
exception when duplicate_object then null; end $$;

select cron.unschedule('live-housekeeping') where exists (select 1 from cron.job where jobname = 'live-housekeeping');
select cron.schedule('live-housekeeping', '*/5 * * * *', $cron$
  update public.live_streams set ended_at = now()
   where ended_at is null and last_heartbeat_at < now() - interval '5 minutes';
  delete from public.live_viewers where last_seen_at < now() - interval '10 minutes';
  delete from private.rate_limits where window_start < now() - interval '2 days';
$cron$);
