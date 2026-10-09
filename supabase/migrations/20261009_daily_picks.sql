-- Differentiator 1: Daily curated picks (+ shared app_settings for configurable thresholds)
-- Server-side, per user per local day; tier quota; compatibility-ranked; "why this pick" line.

------------------------------------------------------------------------------
-- 0. configurable thresholds (admins edit via SQL / dashboard; clients read-only)
------------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_]{2,64}$'),
  value jsonb not null,
  description text check (description is null or char_length(description) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
drop policy if exists "signed-in users can read app settings" on public.app_settings;
create policy "signed-in users can read app settings" on public.app_settings
  for select to authenticated using (true);

insert into public.app_settings (key, value, description) values
  ('picks_free', '7', 'Daily picks per day — free'),
  ('picks_match_plus', '12', 'Daily picks per day — MATCH+'),
  ('picks_super_match', '20', 'Daily picks per day — SUPER MATCH'),
  ('picks_repeat_days', '14', 'Do not re-pick the same person within N days'),
  ('nudge_after_hours', '24', 'Conversation-starter nudge when no message N hours after matching'),
  ('expiring_after_hours', '72', 'Match becomes "expiring" after N hours of silence'),
  ('expire_window_hours', '48', 'Expiring → expired after N more hours'),
  ('extend_hours', '48', 'Hours added by "Extend" (once per person per match)'),
  ('video_suggest_messages', '10', 'Suggest a video call after N messages from each side'),
  ('date_feedback_prompt_hours', '24', 'Ask for date feedback N hours after both confirmed "We met"'),
  ('real_photos_badge_min', '3', 'Positive date feedbacks needed for the real-photos badge')
on conflict (key) do nothing;

create or replace function private.setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end
    from public.app_settings s where s.key = p_key), p_default);
$$;
revoke all on function private.setting_num(text, numeric) from public, anon;
grant execute on function private.setting_num(text, numeric) to authenticated, service_role;

------------------------------------------------------------------------------
-- 1. tables
------------------------------------------------------------------------------
create table if not exists public.daily_picks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  pick_date date not null,
  target_id uuid not null references public.profiles(id) on delete cascade,
  rank smallint not null check (rank between 1 and 100),
  score smallint not null check (score between 0 and 100),
  reason text not null check (char_length(reason) between 1 and 160),
  acted text check (acted in ('like', 'pass')),
  created_at timestamptz not null default now(),
  primary key (user_id, pick_date, target_id),
  check (user_id <> target_id)
);
create index if not exists daily_picks_target_idx on public.daily_picks (target_id);
create index if not exists daily_picks_user_target_idx on public.daily_picks (user_id, target_id, pick_date desc);
alter table public.daily_picks enable row level security;
revoke all on public.daily_picks from anon, authenticated;
grant select on public.daily_picks to authenticated;
drop policy if exists "users see only their own picks" on public.daily_picks;
create policy "users see only their own picks" on public.daily_picks
  for select to authenticated using (user_id = (select auth.uid()));

-- Which time zone defines "today" for a user (changes allowed once a week → no pick farming).
create table if not exists private.pick_timezones (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tz text not null,
  changed_at timestamptz not null default now()
);
-- One generation/top-up run per user per day.
create table if not exists private.pick_runs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  pick_date date not null,
  quota integer not null,
  generated integer not null,
  ran_at timestamptz not null default now(),
  primary key (user_id, pick_date)
);

------------------------------------------------------------------------------
-- 2. helpers
------------------------------------------------------------------------------
create or replace function private.norm_gender(g text)
returns text language sql immutable set search_path = '' as $$
  select case
    when g is null then null
    when lower(g) in ('woman', 'women', 'female', 'f') then 'w'
    when lower(g) in ('man', 'men', 'male', 'm') then 'm'
    when lower(g) in ('prefer_not', 'prefer not to say', '') then null
    else 'x' end;
$$;

-- Does `prefs` (who someone wants to meet) accept gender `g`? Unstated on either side = yes.
create or replace function private.pref_accepts(prefs text[], g text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(prefs), 0) = 0
      or private.norm_gender(g) is null
      or exists (
        select 1 from unnest(prefs) x
        where lower(x) in ('everyone', 'all', 'any', 'anyone')
           or private.norm_gender(x) = private.norm_gender(g)
           or (private.norm_gender(x) = 'x' and private.norm_gender(g) = 'x'));
$$;

create or replace function private.intention_phrase(c text)
returns text language sql immutable set search_path = '' as $$
  select case c
    when 'serious' then 'a serious relationship'
    when 'casual' then 'casual dating'
    when 'new_people' then 'meeting new people'
    when 'friendship' then 'friendship'
    else null end;
$$;

create or replace function private.picks_quota(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select (case private.active_tier(p_user)
    when 'super_match' then private.setting_num('picks_super_match', 20)
    when 'match_plus' then private.setting_num('picks_match_plus', 12)
    else private.setting_num('picks_free', 7) end)::integer;
$$;

-- Resolve the caller's "today" zone: validate, remember, allow a change at most weekly.
create or replace function private.resolve_pick_tz(p_user uuid, p_tz text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_tz text;
  v_saved private.pick_timezones;
begin
  if p_tz is not null and char_length(p_tz) between 1 and 64 then
    begin
      perform now() at time zone p_tz;
      v_tz := p_tz;
    exception when others then
      v_tz := null;
    end;
  end if;
  select * into v_saved from private.pick_timezones where user_id = p_user;
  if not found then
    insert into private.pick_timezones (user_id, tz) values (p_user, coalesce(v_tz, 'UTC'))
    on conflict (user_id) do nothing;
    return coalesce(v_tz, 'UTC');
  end if;
  if v_tz is not null and v_tz <> v_saved.tz and v_saved.changed_at < now() - interval '7 days' then
    update private.pick_timezones set tz = v_tz, changed_at = now() where user_id = p_user;
    return v_tz;
  end if;
  return v_saved.tz;
end;
$$;

------------------------------------------------------------------------------
-- 3. generation (compatibility: shared interests, intention, distance,
--    mutual preferences, activity/recency; excludes seen/blocked/hidden/incognito)
------------------------------------------------------------------------------
create or replace function private.generate_daily_picks(p_user uuid, p_date date, p_want integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_have integer;
  v_added integer;
  v_repeat integer := private.setting_num('picks_repeat_days', 14)::integer;
begin
  select count(*) into v_have from public.daily_picks where user_id = p_user and pick_date = p_date;
  if v_have >= p_want then return 0; end if;

  with me as (
    select p.id, p.intention, p.gender, p.interested_in, l.cell_lat as lat, l.cell_lng as lng,
           (select count(*) from public.user_interests ui where ui.user_id = p.id) as my_n
    from public.profiles p
    left join private.user_locations l on l.user_id = p.id
    where p.id = p_user
  ), cand as (
    select p.id, p.intention, p.verified, p.friday_answer, p.created_at, p.show_distance,
           case when me.lat is not null and l.cell_lat is not null
                then private.km_between(me.lat, me.lng, l.cell_lat, l.cell_lng) end as km,
           me.my_n, me.intention as my_intention,
           (select array_agg(i.label order by md5(i.label || p_date::text))
              from public.user_interests ui
              join public.interests i on i.id = ui.interest_id
             where ui.user_id = p.id
               and ui.interest_id in (select x.interest_id from public.user_interests x where x.user_id = p_user)) as shared,
           (select count(*) from public.user_interests ui where ui.user_id = p.id) as their_n,
           greatest(p.updated_at,
                    (select max(lk.created_at) from public.likes lk where lk.liker_id = p.id),
                    (select max(pt.updated_at) from public.push_tokens pt where pt.user_id = p.id)) as active_at,
           exists (select 1 from public.likes lk where lk.liker_id = p.id and lk.liked_id = p_user) as likes_me
    from public.profiles p
    cross join me
    left join private.user_locations l on l.user_id = p.id
    where p.id <> p_user
      and p.is_discoverable and p.onboarding_complete and p.hidden_at is null
      and (not p.incognito or private.active_tier(p.id) <> 'super_match'
           or exists (select 1 from public.likes l2 where l2.liker_id = p.id and l2.liked_id = p_user))
      and not exists (select 1 from public.likes l3 where l3.liker_id = p_user and l3.liked_id = p.id)
      and not exists (select 1 from public.passes x where x.passer_id = p_user and x.passed_id = p.id)
      and not public.is_blocked_either_way(p.id, p_user)
      and not exists (select 1 from public.daily_picks dp
                       where dp.user_id = p_user and dp.target_id = p.id and dp.pick_date > p_date - v_repeat)
      and private.pref_accepts(me.interested_in, p.gender)
      and private.pref_accepts(p.interested_in, me.gender)
  ), scored as (
    select c.*,
           coalesce(cardinality(c.shared), 0) as n_shared,
           least(100, greatest(0, round(
             40
             + 30 * coalesce(cardinality(c.shared), 0)::numeric
                  / greatest(1, c.my_n + c.their_n - coalesce(cardinality(c.shared), 0))
             + case when c.my_intention is not null and c.intention = c.my_intention then 12
                    when c.intention = 'figuring_out' or c.my_intention = 'figuring_out' then 4 else 0 end
             + case when c.km is null then 3 when c.km <= 5 then 10 when c.km <= 15 then 7 when c.km <= 40 then 4 else 0 end
             + case when c.active_at > now() - interval '1 day' then 8
                    when c.active_at > now() - interval '3 days' then 5
                    when c.active_at > now() - interval '14 days' then 2 else 0 end
             + case when c.verified then 3 else 0 end
             + case when c.friday_answer is not null then 1 else 0 end
             + case when c.likes_me then 5 else 0 end
             + case when c.created_at > now() - interval '7 days' then 2 else 0 end
           )))::smallint as score
    from cand c
  ), ranked as (
    select s.*, row_number() over (order by s.score desc, md5(s.id::text || p_date::text)) as rn
    from scored s
  )
  insert into public.daily_picks (user_id, pick_date, target_id, rank, score, reason)
  select p_user, p_date, r.id, (v_have + r.rn)::smallint, r.score,
         left(case
           when r.n_shared >= 2 then 'You both love ' || lower(r.shared[1]) || ' and ' || lower(r.shared[2])
           when r.n_shared = 1 then 'You both love ' || lower(r.shared[1])
           when r.my_intention is not null and r.intention = r.my_intention and private.intention_phrase(r.intention) is not null
             then 'You''re both looking for ' || private.intention_phrase(r.intention)
           when r.km is not null and r.km <= 5 and r.show_distance then 'Just ' || greatest(1, round(r.km))::int || ' km away'
           when r.km is not null and r.km <= 5 then 'Lives close to you'
           when r.active_at > now() - interval '1 day' then 'Active today — a good time to say hi'
           when r.created_at > now() - interval '7 days' then 'New on MATCH this week'
           when r.friday_answer is not null then 'Their perfect Friday: ' || r.friday_answer
           else 'A strong all-round match for you'
         end, 160)
  from ranked r
  where r.rn <= p_want - v_have
  on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;
revoke all on function private.generate_daily_picks(uuid, date, integer) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4. RPC: today's picks (generates on first call of the local day; tops up
--    hourly if the pool was short, or immediately after an upgrade)
------------------------------------------------------------------------------
create or replace function private.get_daily_picks(p_tz text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tz text;
  v_date date;
  v_quota integer;
  v_run private.pick_runs;
  v_n integer;
  v_picks jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.onboarding_complete and p.hidden_at is null) then
    return jsonb_build_object('pick_date', null, 'refreshes_at', null, 'quota', 0, 'picks', '[]'::jsonb);
  end if;
  perform private.hit_rate_limit('daily_picks_min', 30, interval '1 minute');

  v_tz := private.resolve_pick_tz(v_uid, p_tz);
  v_date := (now() at time zone v_tz)::date;
  v_quota := private.picks_quota(v_uid);

  perform pg_advisory_xact_lock(hashtextextended('daily_picks:' || v_uid::text, 0));
  select * into v_run from private.pick_runs where user_id = v_uid and pick_date = v_date;
  if not found
     or (v_run.generated < v_quota and (v_run.ran_at < now() - interval '1 hour' or v_quota > v_run.quota)) then
    perform private.generate_daily_picks(v_uid, v_date, v_quota);
    select count(*) into v_n from public.daily_picks where user_id = v_uid and pick_date = v_date;
    insert into private.pick_runs (user_id, pick_date, quota, generated, ran_at)
    values (v_uid, v_date, v_quota, v_n, now())
    on conflict (user_id, pick_date) do update set quota = excluded.quota, generated = excluded.generated, ran_at = excluded.ran_at;
  end if;

  with me as (
    select l.cell_lat as lat, l.cell_lng as lng from private.user_locations l where l.user_id = v_uid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'birth_date', private.age_anchor(p.birth_date),
           'city', p.city,
           'bio', p.bio,
           'intention', p.intention,
           'verified', coalesce(p.verified, false),
           'friday_answer', p.friday_answer,
           'distance_km', case when p.show_distance and (select lat from me) is not null and l.cell_lat is not null
                               then greatest(1, round(private.km_between((select lat from me), (select lng from me), l.cell_lat, l.cell_lng)))::integer end,
           'super_liked_me', exists (select 1 from public.likes lk where lk.liker_id = p.id and lk.liked_id = v_uid and lk.is_super_like),
           'reason', dp.reason,
           'rank', dp.rank,
           'acted', dp.acted) order by dp.rank), '[]'::jsonb)
    into v_picks
  from public.daily_picks dp
  join public.profiles p on p.id = dp.target_id
  left join private.user_locations l on l.user_id = p.id
  where dp.user_id = v_uid and dp.pick_date = v_date
    and p.hidden_at is null and p.is_discoverable
    and not public.is_blocked_either_way(p.id, v_uid);

  return jsonb_build_object(
    'pick_date', v_date,
    'refreshes_at', ((v_date + 1)::timestamp at time zone v_tz),
    'quota', v_quota,
    'picks', v_picks);
end;
$$;
revoke all on function private.get_daily_picks(text) from public, anon;
grant execute on function private.get_daily_picks(text) to authenticated;

create or replace function public.get_daily_picks(p_tz text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_daily_picks(p_tz) $$;
revoke all on function public.get_daily_picks(text) from public, anon;
grant execute on function public.get_daily_picks(text) to authenticated;

------------------------------------------------------------------------------
-- 5. keep `acted` in sync with likes / passes (and rewinds)
------------------------------------------------------------------------------
create or replace function private.daily_picks_on_swipe()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'likes' then
    if tg_op = 'INSERT' then
      update public.daily_picks set acted = 'like'
       where user_id = new.liker_id and target_id = new.liked_id and acted is distinct from 'like';
    else
      update public.daily_picks set acted = null
       where user_id = old.liker_id and target_id = old.liked_id and acted = 'like';
    end if;
  else
    if tg_op in ('INSERT', 'UPDATE') then
      update public.daily_picks set acted = 'pass'
       where user_id = new.passer_id and target_id = new.passed_id and acted is null;
    else
      update public.daily_picks set acted = null
       where user_id = old.passer_id and target_id = old.passed_id and acted = 'pass';
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists daily_picks_on_like on public.likes;
create trigger daily_picks_on_like after insert or delete on public.likes
  for each row execute function private.daily_picks_on_swipe();
drop trigger if exists daily_picks_on_pass on public.passes;
create trigger daily_picks_on_pass after insert or update or delete on public.passes
  for each row execute function private.daily_picks_on_swipe();

------------------------------------------------------------------------------
-- 6. likes on your own recent picks don't use the free daily like allowance
------------------------------------------------------------------------------
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
  if v_tier = 'free' and not exists (
       select 1 from public.daily_picks dp
        where dp.user_id = new.liker_id and dp.target_id = new.liked_id and dp.pick_date >= current_date - 2) then
    select count(*) into v_likes from public.likes l
     where l.liker_id = new.liker_id and l.created_at > now() - interval '24 hours'
       and not exists (select 1 from public.daily_picks dp
                        where dp.user_id = l.liker_id and dp.target_id = l.liked_id and dp.pick_date >= current_date - 2);
    if v_likes >= 25 then
      raise exception 'daily_like_limit' using errcode = 'P0001', hint = 'MATCH+ unlocks unlimited likes';
    end if;
  end if;
  return new;
end;
$$;
