-- Security hardening, part 2: rate limits, report queue/auto-hide, admin RPCs, DOB-free RPCs,
-- advisor fixes, storage. See 20261008_security_hardening.sql and docs/SECURITY.md.

-- ───────────────────────── D. rate limits ─────────────────────────
create or replace function private.rate_limit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- TG_ARGV: action, max hits, window
  perform private.hit_rate_limit(tg_argv[0], tg_argv[1]::integer, tg_argv[2]::interval);
  return new;
end;
$$;
revoke all on function private.rate_limit_trigger() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('messages',        'rl_message_min',        'message_min',        '30',   '1 minute'),
    ('messages',        'rl_message_day',        'message_day',        '2000', '1 day'),
    ('comments',        'rl_comment_min',        'comment_min',        '10',   '1 minute'),
    ('comments',        'rl_comment_day',        'comment_day',        '300',  '1 day'),
    ('posts',           'rl_post_hour',          'post_hour',          '10',   '1 hour'),
    ('posts',           'rl_post_day',           'post_day',           '30',   '1 day'),
    ('stories',         'rl_story_day',          'story_day',          '30',   '1 day'),
    ('events',          'rl_event_day',          'event_day',          '10',   '1 day'),
    ('reports',         'rl_report_day',         'report_day',         '10',   '1 day'),
    ('story_responses', 'rl_story_response_min', 'story_response_min', '30',   '1 minute'),
    ('post_likes',      'rl_post_like_min',      'post_like_min',      '60',   '1 minute'),
    ('likes',           'rl_like_min',           'like_min',           '60',   '1 minute'),
    ('blocks',          'rl_block_day',          'block_day',          '100',  '1 day'),
    ('photos',          'rl_photo_day',          'photo_day',          '50',   '1 day'),
    ('verifications',   'rl_verification_day',   'verification_day',   '5',    '1 day')
  ) as t(tbl, trg, action, maxhits, win)
  loop
    execute format('drop trigger if exists %I on public.%I', r.trg, r.tbl);
    execute format('create trigger %I before insert on public.%I for each row execute function private.rate_limit_trigger(%L, %L, %L)',
                   r.trg, r.tbl, r.action, r.maxhits, r.win);
  end loop;
end $$;

-- photos: at most 9 per user.
create or replace function private.photos_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.photos p where p.user_id = new.user_id) >= 9 then
    raise exception 'photo_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.photos_limit() from public, anon, authenticated;
drop trigger if exists photos_limit on public.photos;
create trigger photos_limit before insert on public.photos for each row execute function private.photos_limit();

-- ───────────────────────── F(2). report queue + auto-hide ─────────────────────────
create or replace function private.reports_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.reporter_id := coalesce((select auth.uid()), new.reporter_id);
  new.status := 'open';
  new.resolution := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.details := nullif(btrim(new.details), '');
  -- Derive the reported user from the reported content when only the content is given.
  if new.reported_id is null and new.post_id is not null then
    select p.user_id into new.reported_id from public.posts p where p.id = new.post_id;
  elsif new.reported_id is null and new.comment_id is not null then
    select c.user_id into new.reported_id from public.comments c where c.id = new.comment_id;
  elsif new.reported_id is null and new.live_stream_id is not null then
    select s.host_id into new.reported_id from public.live_streams s where s.id = new.live_stream_id;
  end if;
  return new;
end;
$$;
revoke all on function private.reports_before_insert() from public, anon, authenticated;
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports for each row execute function private.reports_before_insert();

create or replace function private.reports_auto_hide()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_threshold constant integer := 3;   -- distinct reporters within 30 days
  n integer;
begin
  if new.reported_id is not null and new.post_id is null and new.comment_id is null then
    select count(distinct r.reporter_id) into n from public.reports r
     where r.reported_id = new.reported_id and r.post_id is null and r.comment_id is null
       and r.created_at > now() - interval '30 days' and r.resolution is distinct from 'dismissed';
    if n >= v_threshold then
      update public.profiles set hidden_at = coalesce(hidden_at, now()) where id = new.reported_id and not is_admin;
      update public.live_streams set ended_at = now() where host_id = new.reported_id and ended_at is null;
    end if;
  end if;
  if new.post_id is not null then
    select count(distinct r.reporter_id) into n from public.reports r
     where r.post_id = new.post_id and r.resolution is distinct from 'dismissed';
    if n >= v_threshold then
      update public.posts set hidden_at = coalesce(hidden_at, now()) where id = new.post_id;
    end if;
  end if;
  if new.comment_id is not null then
    select count(distinct r.reporter_id) into n from public.reports r
     where r.comment_id = new.comment_id and r.resolution is distinct from 'dismissed';
    if n >= v_threshold then
      update public.comments set hidden_at = coalesce(hidden_at, now()) where id = new.comment_id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.reports_auto_hide() from public, anon, authenticated;
drop trigger if exists reports_auto_hide on public.reports;
create trigger reports_auto_hide after insert on public.reports for each row execute function private.reports_auto_hide();

-- Admin RPCs (profiles.is_admin is set only from the dashboard / service role).
create or replace function private.admin_list_reports(p_status text default 'open', p_limit integer default 100)
returns table (id uuid, created_at timestamptz, status text, category text, details text, reporter_id uuid, reporter_name text,
               reported_id uuid, reported_name text, reported_hidden boolean, post_id uuid, post_excerpt text, post_hidden boolean,
               comment_id uuid, comment_excerpt text, live_stream_id uuid, reports_against_user integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not_admin' using errcode = 'P0001'; end if;
  return query
    select r.id, r.created_at, r.status, r.category, r.details, r.reporter_id, rp.name,
           r.reported_id, tp.name, tp.hidden_at is not null, r.post_id, left(po.content, 200), po.hidden_at is not null,
           r.comment_id, left(co.content, 200), r.live_stream_id,
           (select count(distinct x.reporter_id) from public.reports x where x.reported_id = r.reported_id)::integer
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles tp on tp.id = r.reported_id
    left join public.posts po on po.id = r.post_id
    left join public.comments co on co.id = r.comment_id
    where p_status is null or r.status = p_status
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function private.admin_resolve_report(p_report_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports%rowtype;
begin
  if not private.is_admin() then raise exception 'not_admin' using errcode = 'P0001'; end if;
  select * into r from public.reports where id = p_report_id;
  if not found then raise exception 'report_not_found' using errcode = 'P0001'; end if;
  if p_action = 'reviewing' then
    update public.reports set status = 'reviewing' where id = p_report_id;
    return;
  elsif p_action = 'dismiss' then
    update public.reports set status = 'resolved', resolution = 'dismissed', reviewed_by = (select auth.uid()), reviewed_at = now(),
           details = left(coalesce(details, '') || case when p_note is not null then E'\n[admin] ' || left(p_note, 300) else '' end, 1000)
     where id = p_report_id;
  elsif p_action = 'hide' then
    if r.comment_id is not null then update public.comments set hidden_at = coalesce(hidden_at, now()) where id = r.comment_id;
    elsif r.post_id is not null then update public.posts set hidden_at = coalesce(hidden_at, now()) where id = r.post_id;
    elsif r.reported_id is not null then
      update public.profiles set hidden_at = coalesce(hidden_at, now()) where id = r.reported_id and not is_admin;
      update public.live_streams set ended_at = now() where host_id = r.reported_id and ended_at is null;
    end if;
    update public.reports set status = 'resolved', resolution = 'actioned', reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_report_id;
  elsif p_action = 'unhide' then
    if r.comment_id is not null then update public.comments set hidden_at = null where id = r.comment_id;
    elsif r.post_id is not null then update public.posts set hidden_at = null where id = r.post_id;
    elsif r.reported_id is not null then update public.profiles set hidden_at = null where id = r.reported_id;
    end if;
    update public.reports set status = 'resolved', resolution = 'unhidden', reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_report_id;
  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.admin_review_verification(p_verification_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.is_admin() then raise exception 'not_admin' using errcode = 'P0001'; end if;
  update public.verifications set status = case when p_approve then 'verified' else 'rejected' end, reviewed_at = now()
   where id = p_verification_id returning user_id into v_user;
  if v_user is null then raise exception 'verification_not_found' using errcode = 'P0001'; end if;
  update public.profiles set verified = p_approve where id = v_user;
end;
$$;

create or replace function public.admin_list_reports(p_status text default 'open', p_limit integer default 100)
returns table (id uuid, created_at timestamptz, status text, category text, details text, reporter_id uuid, reporter_name text,
               reported_id uuid, reported_name text, reported_hidden boolean, post_id uuid, post_excerpt text, post_hidden boolean,
               comment_id uuid, comment_excerpt text, live_stream_id uuid, reports_against_user integer)
language sql stable security invoker set search_path = '' as $$ select * from private.admin_list_reports(p_status, p_limit); $$;
create or replace function public.admin_resolve_report(p_report_id uuid, p_action text, p_note text default null)
returns void language sql security invoker set search_path = '' as $$ select private.admin_resolve_report(p_report_id, p_action, p_note); $$;
create or replace function public.admin_review_verification(p_verification_id uuid, p_approve boolean)
returns void language sql security invoker set search_path = '' as $$ select private.admin_review_verification(p_verification_id, p_approve); $$;

-- ───────────────────────── B(2). own profile + DOB-free RPCs ─────────────────────────
create or replace function private.my_profile()
returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles where id = (select auth.uid());
$$;
create or replace function public.get_my_profile()
returns setof public.profiles language sql stable security invoker set search_path = '' as $$
  select * from private.my_profile();
$$;

-- Others never receive the real date of birth: RPCs return an "age anchor" (today minus the
-- person's age in whole years), which yields the same age client-side and nothing more.
create or replace function private.age_anchor(p_birth date)
returns date language sql stable set search_path = '' as $$
  select case when p_birth is null then null
              else (current_date - make_interval(years => extract(year from age(current_date, p_birth))::integer))::date end;
$$;

create or replace function private.visible_person(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_target and (
      p.id = (select auth.uid())
      or (
        p.hidden_at is null
        and not public.is_blocked_either_way(p.id, (select auth.uid()))
        and (
          private.are_matched(p.id, (select auth.uid()))
          or (p.is_discoverable and p.onboarding_complete and (not p.incognito or private.incognito_allows(p.id)))
        )
      )
    )
  );
$$;

create or replace function private.can_see_user(p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    p_author = (select auth.uid())
    or (
      not public.is_blocked_either_way(p_author, (select auth.uid()))
      and not private.is_hidden_user(p_author)
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

create or replace function private.live_can_see(p_stream_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_streams s
    where s.id = p_stream_id
      and (select auth.uid()) is not null
      and (s.host_id = (select auth.uid()) or not private.is_hidden_user(s.host_id))
      and not public.is_blocked_either_way(s.host_id, (select auth.uid()))
      and (s.guest_id is null or not public.is_blocked_either_way(s.guest_id, (select auth.uid())))
  );
$$;

create or replace function private.likes_received()
returns table (liker_id uuid, name text, birth_date date, city text, is_super_like boolean, liked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.active_tier((select auth.uid())) = 'free' then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'MATCH+ shows who liked you';
  end if;
  return query
    select l.liker_id, p.name, private.age_anchor(p.birth_date), p.city, l.is_super_like, l.created_at
    from public.likes l
    join public.profiles p on p.id = l.liker_id
    where l.liked_id = (select auth.uid())
      and p.hidden_at is null
      and not exists (select 1 from public.likes back where back.liker_id = l.liked_id and back.liked_id = l.liker_id)
      and not public.is_blocked_either_way(l.liker_id, l.liked_id)
    order by l.is_super_like desc, l.created_at desc
    limit 100;
end;
$$;

create or replace function private.profile_viewers()
returns table (viewer_id uuid, name text, birth_date date, city text, viewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.tier_at_least((select auth.uid()), 'super_match') then
    raise exception 'premium_required' using errcode = 'P0001', hint = 'SUPER MATCH shows who viewed you';
  end if;
  return query
    select v.viewer_id, p.name, private.age_anchor(p.birth_date), p.city, v.viewed_at
    from public.profile_views v join public.profiles p on p.id = v.viewer_id
    where v.viewed_id = (select auth.uid()) and v.viewed_at > now() - interval '30 days'
      and p.hidden_at is null
      and not public.is_blocked_either_way(v.viewer_id, v.viewed_id)
    order by v.viewed_at desc limit 100;
end;
$$;

create or replace function private.event_attendees(p_event_id uuid)
returns table (user_id uuid, name text, birth_date date, status text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select ep.user_id, p.name,
         case when ep.user_id = (select auth.uid()) then p.birth_date else private.age_anchor(p.birth_date) end,
         ep.status, ep.user_id = (select auth.uid())
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
      and p.show_distance and p.is_discoverable and p.onboarding_complete and p.hidden_at is null
      and l.updated_at > now() - interval '30 days'
      and private.visible_person(p.id)
  )
  select c.id, c.name, private.age_anchor(c.birth_date),
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

create or replace function private.discover_deck(p_limit integer default 40, p_include_passed boolean default false,
  p_max_km double precision default null, p_min_age integer default null, p_max_age integer default null,
  p_verified_only boolean default false, p_intention text default null)
returns table (id uuid, name text, birth_date date, city text, bio text, intention text, verified boolean, friday_answer text,
               distance_km integer, boosted boolean, super_liked_me boolean)
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
  select d.id, d.name, private.age_anchor(d.birth_date), d.city, d.bio, d.intention, coalesce(d.verified, false), d.friday_answer,
         case when d.show_distance and d.km is not null then greatest(1, round(d.km))::integer end,
         exists (select 1 from public.boosts b where b.user_id = d.id and now() between b.starts_at and b.ends_at),
         exists (select 1 from public.likes l where l.liker_id = d.id and l.liked_id = d.me_uid and l.is_super_like)
  from d
  where d.id <> d.me_uid
    and d.is_discoverable and d.onboarding_complete and d.hidden_at is null
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

-- ───────────────────────── G. advisor fixes ─────────────────────────
create or replace function private.ensure_conversation(p_match_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.matches m where m.id = p_match_id
                 and (m.user_a = (select auth.uid()) or m.user_b = (select auth.uid()))) then
    raise exception 'not a participant of this match' using errcode = 'P0001';
  end if;
  insert into public.conversations (match_id) values (p_match_id) on conflict (match_id) do nothing;
  select c.id into v_id from public.conversations c where c.match_id = p_match_id;
  return v_id;
end;
$$;
create or replace function private.blocked_peer_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select b.blocked_id from public.blocks b where b.blocker_id = (select auth.uid())
  union
  select b.blocker_id from public.blocks b where b.blocked_id = (select auth.uid());
$$;
drop function if exists public.ensure_conversation(uuid);
drop function if exists public.get_blocked_peer_ids();
create function public.ensure_conversation(p_match_id uuid)
returns uuid language sql security invoker set search_path = '' as $$ select private.ensure_conversation(p_match_id); $$;
create function public.get_blocked_peer_ids()
returns setof uuid language sql stable security invoker set search_path = '' as $$ select * from private.blocked_peer_ids(); $$;

alter function public.is_blocked_either_way(uuid, uuid) set search_path = '';
alter function public.try_create_match() set search_path = '';
alter function public.create_conversation_for_match() set search_path = '';

-- Execute grants for everything new / recreated.
do $$
declare f text;
begin
  foreach f in array array[
    'private.admin_list_reports(text, integer)', 'private.admin_resolve_report(uuid, text, text)',
    'private.admin_review_verification(uuid, boolean)', 'private.my_profile()', 'private.age_anchor(date)',
    'private.ensure_conversation(uuid)', 'private.blocked_peer_ids()',
    'public.admin_list_reports(text, integer)', 'public.admin_resolve_report(uuid, text, text)',
    'public.admin_review_verification(uuid, boolean)', 'public.get_my_profile()',
    'public.ensure_conversation(uuid)', 'public.get_blocked_peer_ids()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────── H. storage ─────────────────────────
drop policy if exists "profile photos are publicly readable" on storage.objects;
create policy "profile photos are readable by signed-in users" on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos');
