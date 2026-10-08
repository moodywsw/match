-- Basic filters for every tier = age range + distance (the UI uses coarse
-- 5-year / 5-km steps for free and 1-step for MATCH+). Verified-only and
-- intention stay MATCH+-only server-side. Signature unchanged, so existing
-- grants and the public.get_discover_deck invoker wrapper keep working.
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
    -- basic (all tiers): age range + distance
    and (p_min_age is null or p.birth_date <= (current_date - make_interval(years => p_min_age))::date)
    and (p_max_age is null or p.birth_date > (current_date - make_interval(years => p_max_age + 1))::date)
    -- advanced (MATCH+ only; silently ignored for free)
    and (not me.plus or (
          (not coalesce(p_verified_only, false) or p.verified)
          and (p_intention is null or p.intention = p_intention)
        ))
    and (p_max_km is null or me.lat is null or me.lng is null or p.approx_lat is null or p.approx_lng is null
         or 2 * 6371 * asin(sqrt(
              power(sin(radians(p.approx_lat - me.lat) / 2), 2)
              + cos(radians(me.lat)) * cos(radians(p.approx_lat)) * power(sin(radians(p.approx_lng - me.lng) / 2), 2)
            )) <= p_max_km)
  order by super_liked_me desc, boosted desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;
