-- Premium perks (approved set). Everything that matters is enforced here;
-- the app only reflects it.
--
-- FREE        25 likes / 24h, 1 super like / 24h, basic filters (distance)
-- MATCH+      unlimited likes, who-liked-you list, advanced filters, 5 super likes / 24h
--             (recipient notified + highlighted on their deck), rewind, full compatibility,
--             1 boost / calendar month (30 min at top of Discover)
-- SUPER MATCH everything in MATCH+, incognito (only people you liked see you), unlimited
--             super likes, who viewed your profile, message priority

------------------------------------------------------------------------------
-- helpers
------------------------------------------------------------------------------
create or replace function private.tier_at_least(p_user uuid, p_min text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_min
    when 'free' then true
    when 'match_plus' then private.active_tier(p_user) in ('match_plus', 'super_match')
    when 'super_match' then private.active_tier(p_user) = 'super_match'
    else false end;
$$;
revoke all on function private.tier_at_least(uuid, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- passes (server-side so rewind + deck exclusion work)
------------------------------------------------------------------------------
create table if not exists public.passes (
  passer_id uuid not null references public.profiles(id) on delete cascade,
  passed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (passer_id, passed_id),
  check (passer_id <> passed_id)
);
alter table public.passes enable row level security;
revoke all on public.passes from anon;
grant select, insert, update, delete on public.passes to authenticated;
create index if not exists passes_passer_created_idx on public.passes (passer_id, created_at desc);
drop policy if exists "users see own passes" on public.passes;
create policy "users see own passes" on public.passes for select to authenticated using (passer_id = (select auth.uid()));
drop policy if exists "users pass as themselves" on public.passes;
create policy "users pass as themselves" on public.passes for insert to authenticated with check (passer_id = (select auth.uid()));
drop policy if exists "users update own passes" on public.passes;
create policy "users update own passes" on public.passes for update to authenticated using (passer_id = (select auth.uid())) with check (passer_id = (select auth.uid()));
drop policy if exists "users delete own passes" on public.passes;
create policy "users delete own passes" on public.passes for delete to authenticated using (passer_id = (select auth.uid()));

create or replace function public.record_pass(p_target uuid)
returns void language sql security invoker set search_path = '' as $$
  insert into public.passes (passer_id, passed_id) values ((select auth.uid()), p_target)
  on conflict (passer_id, passed_id) do update set created_at = now();
$$;
revoke all on function public.record_pass(uuid) from public, anon;
grant execute on function public.record_pass(uuid) to authenticated;

------------------------------------------------------------------------------
-- rewind (MATCH+): undo the most recent like/pass (≤24h) if no match formed.
-- Rewound super likes still count toward the daily super-like limit.
------------------------------------------------------------------------------
create table if not exists public.swipe_rewinds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('like', 'pass')),
  was_super boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.swipe_rewinds enable row level security;
revoke all on public.swipe_rewinds from anon, authenticated;
create index if not exists swipe_rewinds_user_created_idx on public.swipe_rewinds (user_id, created_at desc);
drop policy if exists "users see own rewinds" on public.swipe_rewinds;
create policy "users see own rewinds" on public.swipe_rewinds for select to authenticated using (user_id = (select auth.uid()));
grant select on public.swipe_rewinds to authenticated;

create or replace function private.rewind_last_swipe()
returns table (kind text, target_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_like record;
  v_pass record;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.tier_at_least(v_me, 'match_plus') then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'Rewind is part of MATCH+';
  end if;
  select l.id, l.liked_id, l.is_super_like, l.created_at into v_like
    from public.likes l where l.liker_id = v_me and l.created_at > now() - interval '24 hours'
    order by l.created_at desc limit 1;
  select p.passed_id, p.created_at into v_pass
    from public.passes p where p.passer_id = v_me and p.created_at > now() - interval '24 hours'
    order by p.created_at desc limit 1;

  if v_like.id is null and v_pass.passed_id is null then
    raise exception 'nothing_to_rewind' using errcode = 'P0001';
  end if;

  if v_like.id is not null and (v_pass.passed_id is null or v_like.created_at >= v_pass.created_at) then
    if private.are_matched(v_me, v_like.liked_id) then
      raise exception 'already_matched' using errcode = 'P0001', hint = 'You already matched — unmatch instead';
    end if;
    delete from public.likes where id = v_like.id;
    delete from public.notifications n
      where n.user_id = v_like.liked_id and n.actor_id = v_me and n.type = 'super_like'
        and n.created_at >= v_like.created_at - interval '5 seconds';
    insert into public.swipe_rewinds (user_id, target_id, kind, was_super)
      values (v_me, v_like.liked_id, 'like', v_like.is_super_like);
    return query select 'like'::text, v_like.liked_id;
  else
    delete from public.passes where passer_id = v_me and passed_id = v_pass.passed_id;
    insert into public.swipe_rewinds (user_id, target_id, kind) values (v_me, v_pass.passed_id, 'pass');
    return query select 'pass'::text, v_pass.passed_id;
  end if;
end;
$$;
revoke all on function private.rewind_last_swipe() from public, anon;
grant execute on function private.rewind_last_swipe() to authenticated;
create or replace function public.rewind_last_swipe()
returns table (kind text, target_id uuid) language sql volatile security invoker set search_path = '' as $$
  select * from private.rewind_last_swipe();
$$;
revoke all on function public.rewind_last_swipe() from public, anon;
grant execute on function public.rewind_last_swipe() to authenticated;

-- Like limits (re-stated): rewound super likes keep counting.
create or replace function private.enforce_like_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tier text := private.active_tier(new.liker_id);
  v_likes int;
  v_supers int;
begin
  if v_tier = 'super_match' then
    return new;
  end if;
  if new.is_super_like then
    select (select count(*) from public.likes
             where liker_id = new.liker_id and is_super_like and created_at > now() - interval '24 hours')
         + (select count(*) from public.swipe_rewinds
             where user_id = new.liker_id and was_super and created_at > now() - interval '24 hours')
      into v_supers;
    if v_supers >= (case when v_tier = 'match_plus' then 5 else 1 end) then
      raise exception 'super_like_limit' using errcode = 'P0001', hint = 'Upgrade for more super likes';
    end if;
  end if;
  if v_tier = 'free' then
    select count(*) into v_likes from public.likes
     where liker_id = new.liker_id and created_at > now() - interval '24 hours';
    if v_likes >= 25 then
      raise exception 'daily_like_limit' using errcode = 'P0001', hint = 'MATCH+ unlocks unlimited likes';
    end if;
  end if;
  return new;
end;
$$;

------------------------------------------------------------------------------
-- super like → immediate notification for the recipient
------------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('match', 'message', 'post_like', 'comment', 'story_reply', 'super_like'));

create or replace function private.on_super_like_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Fires after on_like_check_match (trigger names sort alphabetically):
  -- if this like made a match, the match notification is enough.
  if new.is_super_like and not private.are_matched(new.liker_id, new.liked_id) then
    perform private.add_notification(new.liked_id, new.liker_id, 'super_like', jsonb_build_object('like_id', new.id));
  end if;
  return new;
end;
$$;
revoke all on function private.on_super_like_notify() from public, anon, authenticated;
drop trigger if exists on_super_like_notify on public.likes;
create trigger on_super_like_notify after insert on public.likes
  for each row execute function private.on_super_like_notify();

------------------------------------------------------------------------------
-- boosts (MATCH+ / SUPER MATCH: 1 per calendar month, 30 minutes)
------------------------------------------------------------------------------
create table if not exists public.boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.boosts enable row level security;
revoke all on public.boosts from anon, authenticated;
grant select on public.boosts to authenticated;
create index if not exists boosts_active_idx on public.boosts (user_id, ends_at desc);
drop policy if exists "users see own boosts" on public.boosts;
create policy "users see own boosts" on public.boosts for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.boost_quota(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case when private.tier_at_least(p_user, 'match_plus') then 1 else 0 end;
$$;
revoke all on function private.boost_quota(uuid) from public, anon, authenticated;

create or replace function private.boost_status()
returns table (active_until timestamptz, used_this_month integer, monthly_quota integer)
language sql stable security definer set search_path = '' as $$
  select
    (select max(b.ends_at) from public.boosts b where b.user_id = (select auth.uid()) and b.ends_at > now()),
    (select count(*)::int from public.boosts b where b.user_id = (select auth.uid())
       and b.starts_at >= date_trunc('month', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon'),
    private.boost_quota((select auth.uid()));
$$;

create or replace function private.activate_boost()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_used int;
  v_end timestamptz;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if private.boost_quota(v_me) = 0 then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'Boosts are part of MATCH+';
  end if;
  perform pg_advisory_xact_lock(hashtext('boost:' || v_me::text));
  if exists (select 1 from public.boosts where user_id = v_me and ends_at > now()) then
    raise exception 'boost_active' using errcode = 'P0001';
  end if;
  select count(*) into v_used from public.boosts
   where user_id = v_me
     and starts_at >= date_trunc('month', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon';
  if v_used >= private.boost_quota(v_me) then
    raise exception 'boost_quota' using errcode = 'P0001', hint = 'Your monthly boost is used — it resets on the 1st';
  end if;
  insert into public.boosts (user_id, ends_at) values (v_me, now() + interval '30 minutes') returning ends_at into v_end;
  return v_end;
end;
$$;

------------------------------------------------------------------------------
-- profile views (recorded on profile open; list is SUPER MATCH)
------------------------------------------------------------------------------
create table if not exists public.profile_views (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (viewer_id, viewed_id),
  check (viewer_id <> viewed_id)
);
alter table public.profile_views enable row level security;
revoke all on public.profile_views from anon, authenticated;
grant select on public.profile_views to authenticated;
create index if not exists profile_views_viewed_idx on public.profile_views (viewed_id, viewed_at desc);
drop policy if exists "viewers see views they made" on public.profile_views;
create policy "viewers see views they made" on public.profile_views for select to authenticated using (viewer_id = (select auth.uid()));

------------------------------------------------------------------------------
-- incognito (SUPER MATCH): only people you liked can see you
------------------------------------------------------------------------------
alter table public.profiles add column if not exists incognito boolean not null default false;

create or replace function private.incognito_active(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.incognito from public.profiles p where p.id = p_user), false)
     and private.active_tier(p_user) = 'super_match';
$$;
revoke all on function private.incognito_active(uuid) from public, anon, authenticated;

-- True when the viewer may see an incognito user's profile.
create or replace function private.incognito_allows(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = (select auth.uid())
      or private.active_tier(p_user) <> 'super_match'
      or exists (select 1 from public.likes l where l.liker_id = p_user and l.liked_id = (select auth.uid()))
      or private.are_matched(p_user, (select auth.uid()));
$$;
revoke all on function private.incognito_allows(uuid) from public, anon;
grant execute on function private.incognito_allows(uuid) to authenticated;

create or replace function private.enforce_incognito_tier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.incognito and (tg_op = 'INSERT' or not old.incognito) and private.active_tier(new.id) <> 'super_match' then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'Incognito is part of SUPER MATCH';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_incognito_tier() from public, anon, authenticated;
drop trigger if exists enforce_incognito_tier on public.profiles;
create trigger enforce_incognito_tier before insert or update of incognito on public.profiles
  for each row execute function private.enforce_incognito_tier();

drop policy if exists "profiles are viewable by authenticated users" on public.profiles;
create policy "profiles are viewable by authenticated users" on public.profiles
  for select to authenticated
  using (is_discoverable = true and (incognito = false or private.incognito_allows(id)));

-- Stories follow the same visibility.
create or replace function private.can_see_user(p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    p_author = (select auth.uid())
    or (
      not public.is_blocked_either_way(p_author, (select auth.uid()))
      and (
        private.are_matched(p_author, (select auth.uid()))
        or exists (
          select 1 from public.profiles p
          where p.id = p_author and p.is_discoverable
            and (not p.incognito or private.incognito_allows(p.id))
        )
      )
    )
  );
$$;

create or replace function private.record_profile_view(p_viewed uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid());
begin
  if v_me is null or p_viewed is null or p_viewed = v_me then return; end if;
  if public.is_blocked_either_way(v_me, p_viewed) then return; end if;
  if private.incognito_active(v_me) then return; end if;  -- incognito browsing leaves no trace
  if not exists (select 1 from public.profiles where id = p_viewed) then return; end if;
  insert into public.profile_views (viewer_id, viewed_id) values (v_me, p_viewed)
  on conflict (viewer_id, viewed_id) do update set viewed_at = now();
end;
$$;

create or replace function private.profile_viewers_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.profile_views v
  where v.viewed_id = (select auth.uid()) and v.viewed_at > now() - interval '30 days'
    and not public.is_blocked_either_way(v.viewer_id, v.viewed_id);
$$;

create or replace function private.profile_viewers()
returns table (viewer_id uuid, name text, birth_date date, city text, viewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.tier_at_least((select auth.uid()), 'super_match') then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'SUPER MATCH shows who viewed you';
  end if;
  return query
    select v.viewer_id, p.name, p.birth_date, p.city, v.viewed_at
    from public.profile_views v join public.profiles p on p.id = v.viewer_id
    where v.viewed_id = (select auth.uid()) and v.viewed_at > now() - interval '30 days'
      and not public.is_blocked_either_way(v.viewer_id, v.viewed_id)
    order by v.viewed_at desc limit 100;
end;
$$;

------------------------------------------------------------------------------
-- message priority (SUPER MATCH): first message to a match is flagged
------------------------------------------------------------------------------
alter table public.messages add column if not exists is_priority boolean not null default false;

create or replace function private.set_message_priority()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.is_priority := private.active_tier(new.sender_id) = 'super_match'
    and not exists (
      select 1 from public.messages m
      where m.conversation_id = new.conversation_id and m.sender_id = new.sender_id
    );
  return new;
end;
$$;
revoke all on function private.set_message_priority() from public, anon, authenticated;
drop trigger if exists set_message_priority on public.messages;
create trigger set_message_priority before insert on public.messages
  for each row execute function private.set_message_priority();

------------------------------------------------------------------------------
-- discovery deck: boosts first-class, super-likers highlighted, incognito,
-- passes, blocks, and advanced filters only honoured for MATCH+.
------------------------------------------------------------------------------
create or replace function private.discover_deck(
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
  approx_lat double precision, approx_lng double precision, boosted boolean, super_liked_me boolean
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select (select auth.uid()) as uid,
           private.tier_at_least((select auth.uid()), 'match_plus') as plus,
           (select approx_lat from public.profiles where id = (select auth.uid())) as lat,
           (select approx_lng from public.profiles where id = (select auth.uid())) as lng
  )
  select p.id, p.name, p.birth_date, p.city, p.bio, p.intention, coalesce(p.verified, false),
         p.approx_lat, p.approx_lng,
         exists (select 1 from public.boosts b where b.user_id = p.id and now() between b.starts_at and b.ends_at) as boosted,
         exists (select 1 from public.likes l where l.liker_id = p.id and l.liked_id = me.uid and l.is_super_like) as super_liked_me
  from public.profiles p cross join me
  where me.uid is not null
    and p.id <> me.uid
    and p.is_discoverable and p.onboarding_complete
    and (not p.incognito or private.active_tier(p.id) <> 'super_match'
         or exists (select 1 from public.likes l2 where l2.liker_id = p.id and l2.liked_id = me.uid))
    and not exists (select 1 from public.likes l3 where l3.liker_id = me.uid and l3.liked_id = p.id)
    and (p_include_passed or not exists (select 1 from public.passes x where x.passer_id = me.uid and x.passed_id = p.id))
    and not public.is_blocked_either_way(p.id, me.uid)
    and (not me.plus or (
          (not coalesce(p_verified_only, false) or p.verified)
          and (p_intention is null or p.intention = p_intention)
          and (p_min_age is null or p.birth_date <= (current_date - make_interval(years => p_min_age))::date)
          and (p_max_age is null or p.birth_date > (current_date - make_interval(years => p_max_age + 1))::date)
        ))
    and (p_max_km is null or me.lat is null or me.lng is null or p.approx_lat is null or p.approx_lng is null
         or 2 * 6371 * asin(sqrt(
              power(sin(radians(p.approx_lat - me.lat) / 2), 2)
              + cos(radians(me.lat)) * cos(radians(p.approx_lat)) * power(sin(radians(p.approx_lng - me.lng) / 2), 2)
            )) <= p_max_km)
  order by super_liked_me desc, boosted desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

------------------------------------------------------------------------------
-- grants + public invoker wrappers (definer bodies stay in `private`)
------------------------------------------------------------------------------
revoke all on function private.boost_status() from public, anon;
revoke all on function private.activate_boost() from public, anon;
revoke all on function private.record_profile_view(uuid) from public, anon;
revoke all on function private.profile_viewers_count() from public, anon;
revoke all on function private.profile_viewers() from public, anon;
revoke all on function private.discover_deck(integer, boolean, double precision, integer, integer, boolean, text) from public, anon;
grant execute on function private.boost_status() to authenticated;
grant execute on function private.activate_boost() to authenticated;
grant execute on function private.record_profile_view(uuid) to authenticated;
grant execute on function private.profile_viewers_count() to authenticated;
grant execute on function private.profile_viewers() to authenticated;
grant execute on function private.discover_deck(integer, boolean, double precision, integer, integer, boolean, text) to authenticated;

create or replace function public.get_boost_status()
returns table (active_until timestamptz, used_this_month integer, monthly_quota integer)
language sql stable security invoker set search_path = '' as $$ select * from private.boost_status(); $$;
create or replace function public.activate_boost()
returns timestamptz language sql volatile security invoker set search_path = '' as $$ select private.activate_boost(); $$;
create or replace function public.record_profile_view(p_viewed uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select private.record_profile_view(p_viewed); $$;
create or replace function public.get_profile_viewers_count()
returns integer language sql stable security invoker set search_path = '' as $$ select private.profile_viewers_count(); $$;
create or replace function public.get_profile_viewers()
returns table (viewer_id uuid, name text, birth_date date, city text, viewed_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.profile_viewers(); $$;
create or replace function public.get_discover_deck(
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
  approx_lat double precision, approx_lng double precision, boosted boolean, super_liked_me boolean
)
language sql stable security invoker set search_path = '' as $$
  select * from private.discover_deck(p_limit, p_include_passed, p_max_km, p_min_age, p_max_age, p_verified_only, p_intention);
$$;

revoke all on function public.get_boost_status() from public, anon;
revoke all on function public.activate_boost() from public, anon;
revoke all on function public.record_profile_view(uuid) from public, anon;
revoke all on function public.get_profile_viewers_count() from public, anon;
revoke all on function public.get_profile_viewers() from public, anon;
revoke all on function public.get_discover_deck(integer, boolean, double precision, integer, integer, boolean, text) from public, anon;
grant execute on function public.get_boost_status() to authenticated;
grant execute on function public.activate_boost() to authenticated;
grant execute on function public.record_profile_view(uuid) to authenticated;
grant execute on function public.get_profile_viewers_count() to authenticated;
grant execute on function public.get_profile_viewers() to authenticated;
grant execute on function public.get_discover_deck(integer, boolean, double precision, integer, integer, boolean, text) to authenticated;
