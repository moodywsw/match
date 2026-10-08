-- Phase 5: real events, coarse location + map, read receipts, story activity,
-- story-like / event notifications, story media cleanup.
-- Patterns: SECURITY DEFINER bodies in `private`, SECURITY INVOKER wrappers in
-- `public`; P0001 error codes the client matches on.

------------------------------------------------------------------------------
-- 0. notification types
------------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'match','message','post_like','comment','story_reply','super_like',
  'story_like','event_update','event_cancelled']));

------------------------------------------------------------------------------
-- 1. helpers
------------------------------------------------------------------------------
create or replace function private.km_between(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))));
$$;

-- Snap a coordinate to the centre of a ~p_km grid cell. Raw input is never stored.
create or replace function private.snap_cell(p_lat double precision, p_lng double precision, p_km double precision default 1.5)
returns table (cell_lat double precision, cell_lng double precision)
language sql immutable set search_path = '' as $$
  with a as (select p_km / 111.32 as dlat),
       b as (select a.dlat, (floor(p_lat / a.dlat) + 0.5) * a.dlat as clat from a),
       c as (select b.clat, b.dlat / greatest(cos(radians(b.clat)), 0.05) as dlng from b)
  select c.clat, (floor(p_lng / c.dlng) + 0.5) * c.dlng from c;
$$;

-- Can the signed-in user see this person (blocks, discoverable, incognito, matches)?
create or replace function private.visible_person(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_target and (
      p.id = (select auth.uid())
      or (
        not public.is_blocked_either_way(p.id, (select auth.uid()))
        and (
          private.are_matched(p.id, (select auth.uid()))
          or (p.is_discoverable and p.onboarding_complete and (not p.incognito or private.incognito_allows(p.id)))
        )
      )
    )
  );
$$;
revoke all on function private.visible_person(uuid) from public, anon;
grant execute on function private.visible_person(uuid) to authenticated;

------------------------------------------------------------------------------
-- 2. coarse location (only a ~1.5 km grid cell is stored; never returned raw)
------------------------------------------------------------------------------
create table if not exists private.user_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cell_lat double precision not null,
  cell_lng double precision not null,
  updated_at timestamptz not null default now()
);
alter table private.user_locations enable row level security;
revoke all on private.user_locations from public, anon, authenticated;

create or replace function private.set_my_location(p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); c record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_lat is null or p_lng is null or p_lat not between -85 and 85 or p_lng not between -180 and 180 then
    raise exception 'bad_location' using errcode = 'P0001';
  end if;
  select * into c from private.snap_cell(p_lat, p_lng, 1.5);
  insert into private.user_locations (user_id, cell_lat, cell_lng, updated_at)
  values (v_uid, c.cell_lat, c.cell_lng, now())
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng, updated_at = now();
end;
$$;

create or replace function private.clear_my_location()
returns void language sql security definer set search_path = '' as $$
  delete from private.user_locations where user_id = (select auth.uid());
$$;

create or replace function private.my_location_status()
returns table (has_location boolean, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.user_id is not null, l.updated_at
  from (select 1) x left join private.user_locations l on l.user_id = (select auth.uid());
$$;

-- People for the map: relative offsets (km east / north of the viewer's own cell)
-- with a stable per-pair jitter of ±0.6 km, so the client only ever gets a ring.
create or replace function private.map_people(p_max_km double precision default 25, p_limit integer default 40)
returns table (id uuid, name text, birth_date date, dx_km double precision, dy_km double precision, distance_km integer)
language sql stable security definer set search_path = '' as $$
  with me as (
    select l.cell_lat, l.cell_lng from private.user_locations l where l.user_id = (select auth.uid())
  ), c as (
    select p.id, p.name, p.birth_date, l.cell_lat, l.cell_lng,
           private.km_between(me.cell_lat, me.cell_lng, l.cell_lat, l.cell_lng) as km,
           md5((select auth.uid())::text || ':' || p.id::text) as h
    from me
    cross join public.profiles p
    join private.user_locations l on l.user_id = p.id
    where p.id <> (select auth.uid())
      and p.show_distance and p.is_discoverable and p.onboarding_complete
      and l.updated_at > now() - interval '30 days'
      and private.visible_person(p.id)
  )
  select c.id, c.name, c.birth_date,
    round(((c.cell_lng - me.cell_lng) * 111.32 * cos(radians(me.cell_lat))
           + (('x' || substr(c.h, 1, 4))::bit(16)::integer / 65535.0 - 0.5) * 1.2)::numeric, 1)::double precision,
    round(((c.cell_lat - me.cell_lat) * 111.32
           + (('x' || substr(c.h, 5, 4))::bit(16)::integer / 65535.0 - 0.5) * 1.2)::numeric, 1)::double precision,
    greatest(1, round(c.km))::integer
  from c cross join me
  where c.km <= least(coalesce(p_max_km, 25), 100)
  order by c.km
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

------------------------------------------------------------------------------
-- 3. discover deck: server-side distance from coarse cells, friday answer;
--    approximate coordinates are no longer returned.
------------------------------------------------------------------------------
drop function if exists public.get_discover_deck(integer, boolean, double precision, integer, integer, boolean, text);
drop function if exists private.discover_deck(integer, boolean, double precision, integer, integer, boolean, text);

create function private.discover_deck(
  p_limit integer default 40,
  p_include_passed boolean default false,
  p_max_km double precision default null,
  p_min_age integer default null,
  p_max_age integer default null,
  p_verified_only boolean default false,
  p_intention text default null
)
returns table (
  id uuid, name text, birth_date date, city text, bio text, intention text, verified boolean,
  friday_answer text, distance_km integer, boosted boolean, super_liked_me boolean
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select (select auth.uid()) as uid,
           private.tier_at_least((select auth.uid()), 'match_plus') as plus,
           (select l.cell_lat from private.user_locations l where l.user_id = (select auth.uid())) as lat,
           (select l.cell_lng from private.user_locations l where l.user_id = (select auth.uid())) as lng
  ), d as (
    select p.*, me.uid as me_uid, me.plus as me_plus,
           case when me.lat is not null and l.cell_lat is not null
                then private.km_between(me.lat, me.lng, l.cell_lat, l.cell_lng) end as km
    from public.profiles p
    cross join me
    left join private.user_locations l on l.user_id = p.id
    where me.uid is not null
  )
  select d.id, d.name, d.birth_date, d.city, d.bio, d.intention, coalesce(d.verified, false), d.friday_answer,
         case when d.show_distance and d.km is not null then greatest(1, round(d.km))::integer end,
         exists (select 1 from public.boosts b where b.user_id = d.id and now() between b.starts_at and b.ends_at),
         exists (select 1 from public.likes l where l.liker_id = d.id and l.liked_id = d.me_uid and l.is_super_like)
  from d
  where d.id <> d.me_uid
    and d.is_discoverable and d.onboarding_complete
    and (not d.incognito or private.active_tier(d.id) <> 'super_match'
         or exists (select 1 from public.likes l2 where l2.liker_id = d.id and l2.liked_id = d.me_uid))
    and not exists (select 1 from public.likes l3 where l3.liker_id = d.me_uid and l3.liked_id = d.id)
    and (p_include_passed or not exists (select 1 from public.passes x where x.passer_id = d.me_uid and x.passed_id = d.id))
    and not public.is_blocked_either_way(d.id, d.me_uid)
    and (p_min_age is null or d.birth_date <= (current_date - make_interval(years => p_min_age))::date)
    and (p_max_age is null or d.birth_date > (current_date - make_interval(years => p_max_age + 1))::date)
    and (not d.me_plus or (
          (not coalesce(p_verified_only, false) or d.verified)
          and (p_intention is null or d.intention = p_intention)
        ))
    and (p_max_km is null or d.km is null or d.km <= p_max_km)
  order by 11 desc, 10 desc, d.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

-- raw / approximate coordinates on profiles were readable by every signed-in
-- user through the profiles SELECT policy; location now lives only in
-- private.user_locations (coarse cells). No rows had data.
alter table public.profiles drop column if exists lat;
alter table public.profiles drop column if exists lng;
alter table public.profiles drop column if exists approx_lat;
alter table public.profiles drop column if exists approx_lng;

------------------------------------------------------------------------------
-- 4. events
------------------------------------------------------------------------------
alter table public.events
  add column if not exists creator_id uuid references public.profiles(id) on delete cascade default auth.uid(),
  add column if not exists description text,
  add column if not exists city text,
  add column if not exists area text,
  add column if not exists ends_at timestamptz,
  add column if not exists capacity integer,
  add column if not exists status text not null default 'scheduled',
  add column if not exists cover_path text,
  add column if not exists cell_lat double precision,
  add column if not exists cell_lng double precision,
  add column if not exists updated_at timestamptz not null default now();

alter table public.events drop constraint if exists events_shape_check;
alter table public.events add constraint events_shape_check check (
  char_length(title) between 3 and 80
  and (description is null or char_length(description) <= 1000)
  and (category is null or category = any (array['Nightlife','Music','Dating','Food & drinks','Outdoors','Sports','Culture','Travel','Festival','Other']))
  and (city is null or char_length(city) <= 60)
  and (area is null or char_length(area) <= 80)
  and (location is null or char_length(location) <= 120)
  and (capacity is null or capacity between 2 and 5000)
  and status in ('scheduled', 'cancelled')
  and (ends_at is null or ends_at > starts_at)
  and (cover_path is null or cover_path like (creator_id::text || '/%'))
);
create index if not exists events_starts_at_idx on public.events (starts_at);
create index if not exists events_creator_idx on public.events (creator_id);

create or replace function private.events_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if tg_op = 'INSERT' then
    new.creator_id := (select auth.uid());
    new.status := 'scheduled';
    if new.starts_at < now() then raise exception 'event_in_past' using errcode = 'P0001'; end if;
  else
    new.creator_id := old.creator_id;
    new.created_at := old.created_at;
    if new.starts_at is distinct from old.starts_at and new.starts_at < now() then
      raise exception 'event_in_past' using errcode = 'P0001';
    end if;
  end if;
  if new.cell_lat is not null and new.cell_lng is not null
     and (tg_op = 'INSERT' or new.cell_lat is distinct from old.cell_lat or new.cell_lng is distinct from old.cell_lng) then
    if new.cell_lat not between -85 and 85 or new.cell_lng not between -180 and 180 then
      raise exception 'bad_location' using errcode = 'P0001';
    end if;
    select * into c from private.snap_cell(new.cell_lat, new.cell_lng, 1.5);
    new.cell_lat := c.cell_lat; new.cell_lng := c.cell_lng;
  elsif new.cell_lat is null or new.cell_lng is null then
    new.cell_lat := null; new.cell_lng := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.events_before_write() from public, anon, authenticated;
drop trigger if exists events_before_write on public.events;
create trigger events_before_write before insert or update on public.events
  for each row execute function private.events_before_write();

-- creator is automatically "going"
create or replace function private.events_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.creator_id is not null then
    insert into public.event_participants (event_id, user_id, status) values (new.id, new.creator_id, 'going')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.events_after_insert() from public, anon, authenticated;
drop trigger if exists events_after_insert on public.events;
create trigger events_after_insert after insert on public.events
  for each row execute function private.events_after_insert();

-- notify attendees on meaningful change / cancel / delete
create or replace function private.events_notify_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_changes text[] := '{}'; r record; v_ev public.events;
begin
  if tg_op = 'DELETE' then
    v_type := 'event_cancelled'; v_ev := old;
  else
    v_ev := new;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      v_type := 'event_cancelled';
    else
      if new.title is distinct from old.title then v_changes := v_changes || 'title'; end if;
      if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then v_changes := v_changes || 'time'; end if;
      if new.location is distinct from old.location or new.city is distinct from old.city or new.area is distinct from old.area
         or new.cell_lat is distinct from old.cell_lat or new.cell_lng is distinct from old.cell_lng then v_changes := v_changes || 'place'; end if;
      if new.status = 'scheduled' and old.status = 'cancelled' then v_changes := v_changes || 'reinstated'; end if;
      if cardinality(v_changes) = 0 then return new; end if;
      v_type := 'event_update';
    end if;
  end if;
  for r in select p.user_id from public.event_participants p where p.event_id = v_ev.id and p.user_id is distinct from v_ev.creator_id loop
    perform private.add_notification(r.user_id, v_ev.creator_id, v_type, jsonb_build_object(
      'event_id', v_ev.id, 'title', v_ev.title, 'starts_at', v_ev.starts_at,
      'changes', to_jsonb(v_changes), 'deleted', tg_op = 'DELETE'));
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.events_notify_change() from public, anon, authenticated;
drop trigger if exists events_notify_update on public.events;
create trigger events_notify_update after update on public.events
  for each row execute function private.events_notify_change();
drop trigger if exists events_notify_delete on public.events;
create trigger events_notify_delete before delete on public.events
  for each row execute function private.events_notify_change();

-- RLS: signed-in users see events except from blocked creators; creators manage their own.
drop policy if exists "events are readable by everyone" on public.events;
drop policy if exists "events readable by signed-in users" on public.events;
create policy "events readable by signed-in users" on public.events for select to authenticated
  using (creator_id is null or not public.is_blocked_either_way(creator_id, (select auth.uid())));
drop policy if exists "users create their own events" on public.events;
create policy "users create their own events" on public.events for insert to authenticated
  with check (creator_id = (select auth.uid()));
drop policy if exists "creators update their events" on public.events;
create policy "creators update their events" on public.events for update to authenticated
  using (creator_id = (select auth.uid())) with check (creator_id = (select auth.uid()));
drop policy if exists "creators delete their events" on public.events;
create policy "creators delete their events" on public.events for delete to authenticated
  using (creator_id = (select auth.uid()));

-- the coarse cell is write-only for clients (exposed only as relative offsets via RPC)
revoke select on public.events from anon, authenticated;
grant select (id, title, category, location, starts_at, cover_url, created_at, creator_id, description, city, area,
              ends_at, capacity, status, cover_path, updated_at) on public.events to authenticated;

-- participants: going / interested
alter table public.event_participants add column if not exists status text not null default 'going';
alter table public.event_participants drop constraint if exists event_participants_status_check;
alter table public.event_participants add constraint event_participants_status_check check (status in ('going', 'interested'));

drop policy if exists "participation is viewable by authenticated users" on public.event_participants;
drop policy if exists "users can RSVP only as themselves" on public.event_participants;
drop policy if exists "users see their own RSVPs" on public.event_participants;
create policy "users see their own RSVPs" on public.event_participants for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "users RSVP as themselves" on public.event_participants;
create policy "users RSVP as themselves" on public.event_participants for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "users change their own RSVP" on public.event_participants;
create policy "users change their own RSVP" on public.event_participants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "users remove their own RSVP" on public.event_participants;
create policy "users remove their own RSVP" on public.event_participants for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.enforce_rsvp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e record; n integer;
begin
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  select ev.status, ev.starts_at, ev.capacity, ev.creator_id into e
  from public.events ev where ev.id = new.event_id for update;
  if not found then raise exception 'event_not_found' using errcode = 'P0001'; end if;
  if e.status <> 'scheduled' then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  if e.starts_at < now() - interval '1 hour' then raise exception 'event_past' using errcode = 'P0001'; end if;
  if e.creator_id is not null and e.creator_id <> new.user_id and public.is_blocked_either_way(e.creator_id, new.user_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if new.status = 'going' and e.capacity is not null and (tg_op = 'INSERT' or old.status <> 'going') then
    select count(*) into n from public.event_participants p
    where p.event_id = new.event_id and p.status = 'going' and p.user_id <> new.user_id;
    if n >= e.capacity then raise exception 'event_full' using errcode = 'P0001'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_rsvp() from public, anon, authenticated;
drop trigger if exists enforce_rsvp on public.event_participants;
create trigger enforce_rsvp before insert or update on public.event_participants
  for each row execute function private.enforce_rsvp();

create or replace function private.list_events(
  p_scope text default 'upcoming',
  p_category text default null,
  p_city text default null,
  p_event_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, creator_id uuid, creator_name text, is_mine boolean, title text, description text, category text,
  city text, area text, location text, starts_at timestamptz, ends_at timestamptz, cover_url text,
  capacity integer, status text, going_count integer, interested_count integer, my_status text,
  attendee_ids uuid[], has_location boolean, distance_km integer, dx_km double precision, dy_km double precision
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select (select auth.uid()) as uid,
           (select l.cell_lat from private.user_locations l where l.user_id = (select auth.uid())) as lat,
           (select l.cell_lng from private.user_locations l where l.user_id = (select auth.uid())) as lng
  )
  select e.id, e.creator_id,
         case when e.creator_id is null then null
              when private.visible_person(e.creator_id) then cp.name
              else 'MATCH member' end,
         coalesce(e.creator_id = me.uid, false),
         e.title, e.description, e.category, e.city, e.area, e.location, e.starts_at, e.ends_at, e.cover_url,
         e.capacity, e.status,
         (select count(*) from public.event_participants ep where ep.event_id = e.id and ep.status = 'going')::integer,
         (select count(*) from public.event_participants ep where ep.event_id = e.id and ep.status = 'interested')::integer,
         (select ep.status from public.event_participants ep where ep.event_id = e.id and ep.user_id = me.uid),
         array(select ep.user_id from public.event_participants ep
               where ep.event_id = e.id and ep.status = 'going' and private.visible_person(ep.user_id)
               order by (ep.user_id = me.uid) desc, ep.created_at limit 5),
         e.cell_lat is not null,
         case when me.lat is not null and e.cell_lat is not null
              then greatest(1, round(private.km_between(me.lat, me.lng, e.cell_lat, e.cell_lng)))::integer end,
         case when me.lat is not null and e.cell_lat is not null
              then round(((e.cell_lng - me.lng) * 111.32 * cos(radians(me.lat)))::numeric, 1)::double precision end,
         case when me.lat is not null and e.cell_lat is not null
              then round(((e.cell_lat - me.lat) * 111.32)::numeric, 1)::double precision end
  from public.events e
  cross join me
  left join public.profiles cp on cp.id = e.creator_id
  where me.uid is not null
    and (e.creator_id is null or not public.is_blocked_either_way(e.creator_id, me.uid))
    and (p_event_id is null or e.id = p_event_id)
    and (p_event_id is not null or (
      coalesce(e.ends_at, e.starts_at + interval '4 hours') > now()
      and (e.status = 'scheduled' or e.creator_id = me.uid
           or exists (select 1 from public.event_participants x where x.event_id = e.id and x.user_id = me.uid))
      and (coalesce(p_scope, 'upcoming') <> 'mine' or e.creator_id = me.uid
           or exists (select 1 from public.event_participants x where x.event_id = e.id and x.user_id = me.uid))
      and (p_category is null or e.category = p_category)
      and (p_city is null or e.city ilike '%' || p_city || '%' or e.area ilike '%' || p_city || '%')
    ))
  order by e.starts_at
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- attendee list for the event screen (blocked / hidden / incognito people are omitted)
create or replace function private.event_attendees(p_event_id uuid)
returns table (user_id uuid, name text, birth_date date, status text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select ep.user_id, p.name, p.birth_date, ep.status, ep.user_id = (select auth.uid())
  from public.event_participants ep
  join public.events e on e.id = ep.event_id
  join public.profiles p on p.id = ep.user_id
  where ep.event_id = p_event_id
    and (select auth.uid()) is not null
    and (e.creator_id is null or not public.is_blocked_either_way(e.creator_id, (select auth.uid())))
    and private.visible_person(ep.user_id)
  order by (ep.user_id = (select auth.uid())) desc, (ep.status = 'going') desc, ep.created_at
  limit 200;
$$;

-- event covers: public bucket, owners write to their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "users upload own event covers" on storage.objects;
create policy "users upload own event covers" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "users update own event covers" on storage.objects;
create policy "users update own event covers" on storage.objects for update to authenticated
  using (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "users delete own event covers" on storage.objects;
create policy "users delete own event covers" on storage.objects for delete to authenticated
  using (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

------------------------------------------------------------------------------
-- 5. read receipts
------------------------------------------------------------------------------
alter table public.profiles add column if not exists read_receipts boolean not null default true;

create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from anon, authenticated;
grant select on public.conversation_reads to authenticated;
drop policy if exists "users see their own read markers" on public.conversation_reads;
create policy "users see their own read markers" on public.conversation_reads for select to authenticated
  using (user_id = (select auth.uid()));

-- read_at may only be written by mark_conversation_read (which honours the toggle)
drop policy if exists "participants can mark messages read" on public.messages;
revoke update on public.messages from anon, authenticated;

create or replace function private.mark_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n integer := 0;
begin
  if v_uid is null or not private.is_conversation_member(p_conversation_id) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_uid, now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
  update public.notifications set read_at = now()
   where user_id = v_uid and type = 'message' and read_at is null
     and payload->>'conversation_id' = p_conversation_id::text;
  if coalesce((select p.read_receipts from public.profiles p where p.id = v_uid), true) then
    update public.messages set read_at = now()
     where conversation_id = p_conversation_id and sender_id <> v_uid and read_at is null;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;

------------------------------------------------------------------------------
-- 6. stories: like notifications + owner activity
------------------------------------------------------------------------------
create or replace function private.on_story_response_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select s.user_id into v_owner from public.stories s where s.id = new.story_id;
  if new.kind in ('reply', 'answer') then
    perform private.add_notification(v_owner, new.responder_id, 'story_reply', jsonb_build_object(
      'story_id', new.story_id, 'response_id', new.id, 'kind', new.kind,
      'preview', left(coalesce(new.body, ''), 120)));
  elsif new.kind = 'like' then
    if not exists (
      select 1 from public.notifications n
      where n.user_id = v_owner and n.actor_id = new.responder_id and n.type = 'story_like'
        and n.payload->>'story_id' = new.story_id::text
    ) then
      perform private.add_notification(v_owner, new.responder_id, 'story_like',
        jsonb_build_object('story_id', new.story_id));
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.story_activity(p_story_id uuid)
returns table (kind text, user_id uuid, name text, body text, option_index integer, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stories s where s.id = p_story_id and s.user_id = (select auth.uid())) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  return query
    select 'view'::text, v.viewer_id, p.name, null::text, null::integer, v.viewed_at
    from public.story_views v join public.profiles p on p.id = v.viewer_id
    where v.story_id = p_story_id and v.viewer_id <> (select auth.uid())
      and not public.is_blocked_either_way(v.viewer_id, (select auth.uid()))
    union all
    select r.kind, r.responder_id, p.name, r.body, r.option_index, r.created_at
    from public.story_responses r join public.profiles p on p.id = r.responder_id
    where r.story_id = p_story_id
      and not public.is_blocked_either_way(r.responder_id, (select auth.uid()))
    order by 6 desc;
end;
$$;

------------------------------------------------------------------------------
-- 7. story media cleanup (edge function `cleanup-story-media`, hourly via pg_cron + pg_net)
------------------------------------------------------------------------------
-- Objects older than the 24h story window that no remaining story references.
-- Only the service role (inside the edge function) may call it.
create or replace function public.story_media_garbage(p_limit integer default 500)
returns table (name text)
language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'story-media'
    and o.created_at < now() - interval '26 hours'
    and not exists (select 1 from public.stories s where s.media_path = o.name or s.thumb_path = o.name)
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
revoke all on function public.story_media_garbage(integer) from public, anon, authenticated;
grant execute on function public.story_media_garbage(integer) to service_role;

create extension if not exists pg_net;

-- The bearer is the project's public anon JWT, kept in Vault (set once, outside git):
--   select vault.create_secret('<anon jwt>', 'match_cron_anon_key');
-- Without it the call is rejected (401) and nothing happens.
select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-story-media';
select cron.schedule('cleanup-story-media', '35 * * * *', $cron$
  select net.http_post(
    url := 'https://pkpdheytmbwvqhpcaigm.supabase.co/functions/v1/cleanup-story-media',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'match_cron_anon_key'), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);

------------------------------------------------------------------------------
-- 8. grants + public invoker wrappers
------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'private.set_my_location(double precision, double precision)',
    'private.clear_my_location()',
    'private.my_location_status()',
    'private.map_people(double precision, integer)',
    'private.discover_deck(integer, boolean, double precision, integer, integer, boolean, text)',
    'private.list_events(text, text, text, uuid, integer)',
    'private.event_attendees(uuid)',
    'private.mark_conversation_read(uuid)',
    'private.story_activity(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.km_between(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function private.km_between(double precision, double precision, double precision, double precision) to authenticated;
revoke all on function private.snap_cell(double precision, double precision, double precision) from public, anon;
grant execute on function private.snap_cell(double precision, double precision, double precision) to authenticated;

create or replace function public.set_my_location(p_lat double precision, p_lng double precision)
returns void language sql volatile security invoker set search_path = '' as $$ select private.set_my_location(p_lat, p_lng); $$;
create or replace function public.clear_my_location()
returns void language sql volatile security invoker set search_path = '' as $$ select private.clear_my_location(); $$;
create or replace function public.get_my_location_status()
returns table (has_location boolean, updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.my_location_status(); $$;
create or replace function public.get_map_people(p_max_km double precision default 25, p_limit integer default 40)
returns table (id uuid, name text, birth_date date, dx_km double precision, dy_km double precision, distance_km integer)
language sql stable security invoker set search_path = '' as $$ select * from private.map_people(p_max_km, p_limit); $$;
create function public.get_discover_deck(
  p_limit integer default 40,
  p_include_passed boolean default false,
  p_max_km double precision default null,
  p_min_age integer default null,
  p_max_age integer default null,
  p_verified_only boolean default false,
  p_intention text default null
)
returns table (
  id uuid, name text, birth_date date, city text, bio text, intention text, verified boolean,
  friday_answer text, distance_km integer, boosted boolean, super_liked_me boolean
)
language sql stable security invoker set search_path = '' as $$
  select * from private.discover_deck(p_limit, p_include_passed, p_max_km, p_min_age, p_max_age, p_verified_only, p_intention);
$$;
create or replace function public.get_events(
  p_scope text default 'upcoming', p_category text default null, p_city text default null,
  p_event_id uuid default null, p_limit integer default 50
)
returns table (
  id uuid, creator_id uuid, creator_name text, is_mine boolean, title text, description text, category text,
  city text, area text, location text, starts_at timestamptz, ends_at timestamptz, cover_url text,
  capacity integer, status text, going_count integer, interested_count integer, my_status text,
  attendee_ids uuid[], has_location boolean, distance_km integer, dx_km double precision, dy_km double precision
)
language sql stable security invoker set search_path = '' as $$
  select * from private.list_events(p_scope, p_category, p_city, p_event_id, p_limit);
$$;
create or replace function public.get_event_attendees(p_event_id uuid)
returns table (user_id uuid, name text, birth_date date, status text, is_me boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.event_attendees(p_event_id); $$;
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer language sql volatile security invoker set search_path = '' as $$ select private.mark_conversation_read(p_conversation_id); $$;
create or replace function public.get_story_activity(p_story_id uuid)
returns table (kind text, user_id uuid, name text, body text, option_index integer, at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.story_activity(p_story_id); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_my_location(double precision, double precision)',
    'public.clear_my_location()',
    'public.get_my_location_status()',
    'public.get_map_people(double precision, integer)',
    'public.get_discover_deck(integer, boolean, double precision, integer, integer, boolean, text)',
    'public.get_events(text, text, text, uuid, integer)',
    'public.get_event_attendees(uuid)',
    'public.mark_conversation_read(uuid)',
    'public.get_story_activity(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
