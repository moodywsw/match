-- Speed Dating 1:1 (own hub) + Speed Dating Night (Fridays 21:00 Lisbon).
--   * matchmaking queue (mutual gender prefs, age ranges, distance, optional same intention; blocks, hidden,
--     incognito excluded; already-matched pairs and recent partners skipped; early-leavers deprioritized)
--   * 50 coins per 1:1 date (first one each Lisbon day free), refunded when the partner leaves / no-shows
--     within the first 20 s or when you leave the queue before being paired
--   * private LiveKit room per session (token grant below), 2-minute server-enforced timer,
--     then each side privately picks Match / Pass; mutual = match (+ MATCH moment in the app)
-- All state changes go through SECURITY DEFINER functions; clients have no table access at all
-- (choices stay private until both have decided).

insert into public.app_settings (key, value, description) values
  ('speed_1on1_coins', '50', 'Coins per 1:1 speed date (first one each Lisbon day is free)'),
  ('speed_1on1_seconds', '120', 'Length of a 1:1 speed date in seconds (server-enforced)'),
  ('speed_refund_seconds', '20', 'Partner leaves / no-shows within this many seconds → your coins are refunded'),
  ('speed_ready_seconds', '30', 'Both people must tap "I''m ready" within this many seconds of being paired'),
  ('speed_decide_seconds', '180', 'Time to pick Match / Pass after the date'),
  ('speed_night_dow', '5', 'Speed Dating Night weekday (0=Sun … 5=Fri), Europe/Lisbon'),
  ('speed_night_hour', '21', 'Speed Dating Night start hour, Europe/Lisbon'),
  ('speed_night_hours', '3', 'Speed Dating Night length in hours')
on conflict (key) do nothing;

alter table public.wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('purchase', 'purchase_reversal', 'gift_sent', 'gift_received', 'adjustment', 'reward', 'boost',
                  'speed_date', 'speed_refund'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'match', 'message', 'post_like', 'comment', 'story_reply', 'super_like', 'story_like', 'event_update',
  'event_cancelled', 'missed_call', 'gift', 'chat_nudge', 'match_expiring', 'match_expired', 'match_extended',
  'we_met', 'date_feedback', 'reward', 'speed_night', 'live_invite']));

-- ---------------------------------------------------------------------------
-- tables (no client grants: everything goes through the functions below)
create table if not exists public.speed_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  coins integer not null check (coins >= 0),
  status text not null default 'queued' check (status in ('queued', 'used', 'refunded', 'cancelled')),
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists speed_tickets_user_day_idx on public.speed_tickets (user_id, day);
create index if not exists speed_tickets_session_idx on public.speed_tickets (session_id);

create table if not exists public.speed_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ticket_id uuid not null references public.speed_tickets(id) on delete cascade,
  min_age integer not null default 18 check (min_age between 18 and 99),
  max_age integer not null default 99 check (max_age between 18 and 99),
  max_km integer check (max_km is null or max_km between 1 and 500),
  same_intention boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists speed_queue_ticket_idx on public.speed_queue (ticket_id);

create table if not exists public.speed_sessions (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'live', 'deciding', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz,
  a_ready_at timestamptz, b_ready_at timestamptz,
  a_left_at timestamptz, b_left_at timestamptz,
  a_choice text check (a_choice in ('match', 'pass')),
  b_choice text check (b_choice in ('match', 'pass')),
  ended_reason text,
  match_id uuid references public.matches(id) on delete set null,
  shared_interest text,
  icebreaker text,
  check (user_a <> user_b)
);
create index if not exists speed_sessions_a_idx on public.speed_sessions (user_a, created_at desc);
create index if not exists speed_sessions_b_idx on public.speed_sessions (user_b, created_at desc);
create index if not exists speed_sessions_match_idx on public.speed_sessions (match_id);
create index if not exists speed_sessions_open_idx on public.speed_sessions (status) where status in ('pending', 'live', 'deciding');

create table if not exists public.speed_reputation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  dates integer not null default 0,
  early_leaves integer not null default 0,
  no_shows integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.speed_night_pushes (
  night date primary key,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0
);

alter table public.speed_tickets enable row level security;
alter table public.speed_queue enable row level security;
alter table public.speed_sessions enable row level security;
alter table public.speed_reputation enable row level security;
alter table public.speed_night_pushes enable row level security;
revoke all on public.speed_tickets, public.speed_queue, public.speed_sessions, public.speed_reputation,
  public.speed_night_pushes from anon, authenticated;

-- likes created by a mutual speed date skip the free daily like cap (both people opted in, and paid)
create or replace function private.enforce_like_limits()
 returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_tier text := private.active_tier(new.liker_id);
  v_likes int;
  v_supers int;
begin
  if v_tier = 'super_match' or current_setting('match.like_source', true) = 'speed' then
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
$function$;

-- ---------------------------------------------------------------------------
-- Speed Dating Night (Lisbon wall clock)
create or replace function private.speed_night_info()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_local timestamp := now() at time zone 'Europe/Lisbon';
  v_dow integer := private.setting_num('speed_night_dow', 5)::integer;
  v_hour integer := private.setting_num('speed_night_hour', 21)::integer;
  v_len integer := private.setting_num('speed_night_hours', 3)::integer;
  v_day date := v_local::date;
  v_start timestamp;
  v_end timestamp;
begin
  -- the most recent night start on/before today, or the next one
  v_day := v_day - ((extract(dow from v_day)::integer - v_dow + 7) % 7);
  v_start := v_day + make_interval(hours => v_hour);
  v_end := v_start + make_interval(hours => v_len);
  if v_local >= v_end then
    v_start := v_start + interval '7 days';
    v_end := v_end + interval '7 days';
  end if;
  return jsonb_build_object(
    'active', v_local >= v_start and v_local < v_end,
    'starts_at', v_start at time zone 'Europe/Lisbon',
    'ends_at', v_end at time zone 'Europe/Lisbon');
end;
$$;

-- push once per night, ~15 min before it starts, to recently active people with push on
create or replace function private.speed_night_notify()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := private.speed_night_info();
  v_start timestamptz := (j->>'starts_at')::timestamptz;
  v_night date := ((j->>'starts_at')::timestamptz at time zone 'Europe/Lisbon')::date;
  v_n integer;
begin
  if (j->>'active')::boolean or now() < v_start - interval '20 minutes' or now() >= v_start then return 0; end if;
  insert into public.speed_night_pushes (night) values (v_night) on conflict do nothing;
  if not found then return 0; end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  select p.id, null, 'speed_night', jsonb_build_object('starts_at', v_start)
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.onboarding_complete and p.hidden_at is null and not p.incognito
     and u.last_sign_in_at > now() - interval '30 days'
     and exists (select 1 from public.push_tokens t where t.user_id = p.id)
   limit 20000;
  get diagnostics v_n = row_count;
  update public.speed_night_pushes set recipients = v_n where night = v_night;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- helpers
create or replace function private.speed_free_left(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.speed_tickets t
                      where t.user_id = p_user and t.day = private.lisbon_today()
                        and t.coins = 0 and t.status in ('queued', 'used'));
$$;

create or replace function private.speed_refund_ticket(p_ticket uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.speed_tickets;
begin
  select * into t from public.speed_tickets where id = p_ticket for update;
  if not found or t.status in ('refunded', 'cancelled') then return; end if;
  update public.speed_tickets set status = 'refunded' where id = p_ticket;
  if t.coins > 0 then
    perform private.wallet_apply(t.user_id, 'coins', t.coins, 'speed_refund', null, null, null, null, left(p_note, 200));
  end if;
end;
$$;

create or replace function private.speed_rep_bump(p_user uuid, p_field text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.speed_reputation (user_id) values (p_user) on conflict do nothing;
  if p_field = 'early_leave' then
    update public.speed_reputation set early_leaves = early_leaves + 1, updated_at = now() where user_id = p_user;
  elsif p_field = 'no_show' then
    update public.speed_reputation set no_shows = no_shows + 1, updated_at = now() where user_id = p_user;
  else
    update public.speed_reputation set dates = dates + 1, updated_at = now() where user_id = p_user;
  end if;
end;
$$;

create or replace function private.speed_eligible_block(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null or p.hidden_at is not null or not p.onboarding_complete then 'not_allowed'
    when p.incognito then 'incognito_speed'
    when cardinality(private.live_missing(p.id)) > 0 then 'profile_incomplete'
  end
  from (select 1) one left join public.profiles p on p.id = p_user;
$$;

/** Can these two be paired? Mutual gender prefs, both age ranges, distance, intention, blocks, history. */
create or replace function private.speed_compatible(qa public.speed_queue, qb public.speed_queue)
returns boolean language sql stable security definer set search_path = '' as $$
  select qa.user_id <> qb.user_id
     and pa.hidden_at is null and pb.hidden_at is null and not pa.incognito and not pb.incognito
     and not public.is_blocked_either_way(qa.user_id, qb.user_id)
     and private.pref_accepts(pa.interested_in, pb.gender) and private.pref_accepts(pb.interested_in, pa.gender)
     and pb.birth_date <= (current_date - make_interval(years => qa.min_age))::date
     and pb.birth_date > (current_date - make_interval(years => qa.max_age + 1))::date
     and pa.birth_date <= (current_date - make_interval(years => qb.min_age))::date
     and pa.birth_date > (current_date - make_interval(years => qb.max_age + 1))::date
     and (not (qa.same_intention or qb.same_intention) or pa.intention is not distinct from pb.intention)
     and (coalesce(qa.max_km, qb.max_km) is null or la.cell_lat is null or lb.cell_lat is null
          or private.km_between(la.cell_lat, la.cell_lng, lb.cell_lat, lb.cell_lng)
             <= least(coalesce(qa.max_km, 100000), coalesce(qb.max_km, 100000)))
     and not exists (select 1 from public.matches m where m.user_a = least(qa.user_id, qb.user_id)
                                                     and m.user_b = greatest(qa.user_id, qb.user_id))
     and not exists (select 1 from public.speed_sessions s
                      where s.created_at > now() - interval '7 days'
                        and ((s.user_a = qa.user_id and s.user_b = qb.user_id) or (s.user_a = qb.user_id and s.user_b = qa.user_id)))
  from public.profiles pa, public.profiles pb
  left join private.user_locations lb on lb.user_id = pb.id
  left join private.user_locations la on la.user_id = qa.user_id
  where pa.id = qa.user_id and pb.id = qb.user_id;
$$;

create or replace function private.speed_try_pair(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.speed_queue;
  other public.speed_queue;
  v_session uuid;
  v_interest record;
  v_ice text;
  v_city text;
begin
  perform pg_advisory_xact_lock(hashtext('speed_pairing'));
  select * into me from public.speed_queue where user_id = p_user;
  if not found then return null; end if;
  select q.* into other
    from public.speed_queue q
    left join public.speed_reputation r on r.user_id = q.user_id
   where q.user_id <> p_user
     and q.last_seen_at > now() - interval '45 seconds'
     and private.speed_compatible(me, q)
   order by coalesce(r.early_leaves, 0) + 2 * coalesce(r.no_shows, 0), q.joined_at
   limit 1;
  if not found then return null; end if;

  select i.category, i.label into v_interest
    from public.user_interests a
    join public.user_interests b on b.interest_id = a.interest_id and b.user_id = other.user_id
    join public.interests i on i.id = a.interest_id
   where a.user_id = p_user
   order by random() limit 1;
  select city into v_city from public.profiles where id = other.user_id;
  v_ice := case when v_interest.label is not null then private.starter_for(v_interest.category, v_interest.label, v_city)
                else (array['If you could teleport anywhere this weekend, where would you go?',
                            'What''s the best thing you''ve eaten recently?',
                            'What does your perfect Friday night look like?',
                            'What''s something small that made you smile this week?'])[1 + floor(random() * 4)::integer] end;

  insert into public.speed_sessions (user_a, user_b, shared_interest, icebreaker)
  values (p_user, other.user_id, v_interest.label, v_ice)
  returning id into v_session;
  update public.speed_tickets set status = 'used', session_id = v_session where id in (me.ticket_id, other.ticket_id);
  delete from public.speed_queue where user_id in (p_user, other.user_id);
  return v_session;
end;
$$;

/** Advance one session by the clock: no-shows, end of the 2 minutes, decision timeout. */
create or replace function private.speed_tick(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.speed_sessions;
  v_ready integer := private.setting_num('speed_ready_seconds', 30)::integer;
  v_decide integer := private.setting_num('speed_decide_seconds', 180)::integer;
begin
  select * into s from public.speed_sessions where id = p_session for update;
  if not found then return; end if;
  if s.status = 'pending' and s.created_at < now() - make_interval(secs => v_ready) then
    update public.speed_sessions set status = 'cancelled', ended_reason = 'no_show' where id = s.id;
    -- whoever showed up gets refunded; whoever didn't gets a strike
    if s.a_ready_at is not null then
      perform private.speed_refund_ticket(t.id, 'Speed date refund · no-show') from public.speed_tickets t where t.session_id = s.id and t.user_id = s.user_a;
    else perform private.speed_rep_bump(s.user_a, 'no_show'); end if;
    if s.b_ready_at is not null then
      perform private.speed_refund_ticket(t.id, 'Speed date refund · no-show') from public.speed_tickets t where t.session_id = s.id and t.user_id = s.user_b;
    else perform private.speed_rep_bump(s.user_b, 'no_show'); end if;
  elsif s.status = 'live' and now() >= s.ends_at then
    update public.speed_sessions set status = 'deciding' where id = s.id;
  elsif s.status = 'deciding' and now() >= s.ends_at + make_interval(secs => v_decide) then
    update public.speed_sessions set status = 'done', ended_reason = coalesce(ended_reason, 'no_decision') where id = s.id;
  end if;
end;
$$;

create or replace function private.speed_session_json(p_session uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.speed_sessions;
  v_is_a boolean;
  v_other uuid;
  o public.profiles;
  v_photo text;
  v_mine text;
  v_theirs text;
  v_conv uuid;
  v_refunded boolean;
begin
  select * into s from public.speed_sessions where id = p_session;
  if not found or p_uid not in (s.user_a, s.user_b) then return null; end if;
  v_is_a := s.user_a = p_uid;
  v_other := case when v_is_a then s.user_b else s.user_a end;
  select * into o from public.profiles where id = v_other;
  select ph.url into v_photo from public.photos ph where ph.user_id = v_other order by ph.is_primary desc, ph.position limit 1;
  v_mine := case when v_is_a then s.a_choice else s.b_choice end;
  v_theirs := case when v_is_a then s.b_choice else s.a_choice end;
  if s.match_id is not null then select c.id into v_conv from public.conversations c where c.match_id = s.match_id; end if;
  select exists (select 1 from public.speed_tickets t where t.session_id = s.id and t.user_id = p_uid and t.status = 'refunded')
    into v_refunded;
  return jsonb_build_object(
    'id', s.id, 'status', s.status, 'created_at', s.created_at, 'started_at', s.started_at, 'ends_at', s.ends_at,
    'ready_deadline', s.created_at + make_interval(secs => private.setting_num('speed_ready_seconds', 30)::integer),
    'decide_deadline', s.ends_at + make_interval(secs => private.setting_num('speed_decide_seconds', 180)::integer),
    'refund_until', s.started_at + make_interval(secs => private.setting_num('speed_refund_seconds', 20)::integer),
    'me_ready', case when v_is_a then s.a_ready_at else s.b_ready_at end is not null,
    'partner_ready', case when v_is_a then s.b_ready_at else s.a_ready_at end is not null,
    'partner_left', case when v_is_a then s.b_left_at else s.a_left_at end is not null,
    'my_choice', v_mine,
    -- the partner's pick is revealed only as the joint outcome, once both have decided
    'outcome', case when s.status = 'done' and v_mine is not null and v_theirs is not null
                    then case when v_mine = 'match' and v_theirs = 'match' then 'match' else 'no_match' end end,
    'ended_reason', s.ended_reason,
    'refunded', v_refunded,
    'match_id', s.match_id, 'conversation_id', v_conv,
    'shared_interest', s.shared_interest, 'icebreaker', s.icebreaker,
    'partner', jsonb_build_object('id', o.id, 'name', coalesce(o.name, 'Someone'),
                                  'age', private.age_anchor(o.birth_date), 'photo', v_photo,
                                  'intention', o.intention, 'verified', coalesce(o.verified, false)));
end;
$$;

-- ---------------------------------------------------------------------------
-- public API
create or replace function private.speed_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  q public.speed_queue;
  v_session uuid;
  v_waiting integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  -- open session first
  select s.id into v_session from public.speed_sessions s
   where v_uid in (s.user_a, s.user_b) and s.status in ('pending', 'live', 'deciding')
   order by s.created_at desc limit 1;
  if v_session is not null then perform private.speed_tick(v_session); end if;
  select * into q from public.speed_queue where user_id = v_uid;
  if found then
    update public.speed_queue set last_seen_at = now() where user_id = v_uid;
    v_session := coalesce(private.speed_try_pair(v_uid), v_session);
  end if;
  if v_session is null then
    -- a session that ended in the last 3 minutes (result / refund screen)
    select s.id into v_session from public.speed_sessions s
     where v_uid in (s.user_a, s.user_b) and s.created_at > now() - interval '15 minutes'
       and (s.status in ('pending', 'live', 'deciding')
            or coalesce(s.ends_at, s.created_at) > now() - interval '4 minutes')
     order by s.created_at desc limit 1;
  end if;
  select count(*) into v_waiting from public.speed_queue where last_seen_at > now() - interval '45 seconds';
  return jsonb_build_object(
    'state', case when v_session is not null and exists (select 1 from public.speed_sessions s where s.id = v_session
                                                          and s.status in ('pending', 'live', 'deciding')) then 'session'
                  when exists (select 1 from public.speed_queue where user_id = v_uid) then 'queued'
                  else 'idle' end,
    'session', case when v_session is null then null else private.speed_session_json(v_session, v_uid) end,
    'queued_at', (select joined_at from public.speed_queue where user_id = v_uid),
    'waiting', v_waiting,
    'price', private.setting_num('speed_1on1_coins', 50),
    'free_today', private.speed_free_left(v_uid),
    'seconds', private.setting_num('speed_1on1_seconds', 120),
    'refund_seconds', private.setting_num('speed_refund_seconds', 20),
    'coins', coalesce((select w.coins from public.wallets w where w.user_id = v_uid), 0),
    'block', private.speed_eligible_block(v_uid),
    'missing', to_jsonb(private.live_missing(v_uid)),
    'night', private.speed_night_info());
end;
$$;

create or replace function private.speed_join(p_min_age integer default 18, p_max_age integer default 99,
                                              p_max_km integer default null, p_same_intention boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_block text;
  v_price integer := private.setting_num('speed_1on1_coins', 50)::integer;
  v_coins integer;
  v_ticket uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  v_block := private.speed_eligible_block(v_uid);
  if v_block = 'profile_incomplete' then
    raise exception 'profile_incomplete' using errcode = 'P0001', detail = array_to_string(private.live_missing(v_uid), ',');
  elsif v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;
  if p_min_age is null or p_max_age is null or p_min_age < 18 or p_max_age > 99 or p_min_age > p_max_age
     or (p_max_km is not null and (p_max_km < 1 or p_max_km > 500)) then
    raise exception 'invalid_preferences' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('speed_user:' || v_uid::text));
  if exists (select 1 from public.speed_sessions s where v_uid in (s.user_a, s.user_b) and s.status in ('pending', 'live', 'deciding')) then
    raise exception 'already_in_session' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.speed_queue where user_id = v_uid) then
    update public.speed_queue set min_age = p_min_age, max_age = p_max_age, max_km = p_max_km,
           same_intention = coalesce(p_same_intention, false), last_seen_at = now() where user_id = v_uid;
    return private.speed_status();
  end if;
  perform private.hit_rate_limit('speed_join', 30, interval '1 hour');
  v_coins := case when private.speed_free_left(v_uid) then 0 else v_price end;
  insert into public.speed_tickets (user_id, day, coins) values (v_uid, private.lisbon_today(), v_coins)
  returning id into v_ticket;
  if v_coins > 0 then
    perform private.wallet_apply(v_uid, 'coins', -v_coins, 'speed_date', null, null, null, null, 'Speed date · 1:1');
  end if;
  insert into public.speed_queue (user_id, ticket_id, min_age, max_age, max_km, same_intention)
  values (v_uid, v_ticket, p_min_age, p_max_age, p_max_km, coalesce(p_same_intention, false));
  perform private.speed_try_pair(v_uid);
  return private.speed_status();
end;
$$;

create or replace function private.speed_leave_queue()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); q public.speed_queue;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  delete from public.speed_queue where user_id = v_uid returning * into q;
  if found then
    -- leaving the queue before a pairing gives everything back (a free ticket becomes free again)
    update public.speed_tickets set status = 'cancelled' where id = q.ticket_id and coins = 0 and status = 'queued';
    perform private.speed_refund_ticket(q.ticket_id, 'Speed date · left the queue');
  end if;
  return private.speed_status();
end;
$$;

create or replace function private.speed_ready(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  s public.speed_sessions;
  v_secs integer := private.setting_num('speed_1on1_seconds', 120)::integer;
begin
  perform private.speed_tick(p_session);
  select * into s from public.speed_sessions where id = p_session for update;
  if not found or v_uid not in (s.user_a, s.user_b) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if s.status <> 'pending' then return private.speed_session_json(p_session, v_uid); end if;
  if public.is_blocked_either_way(s.user_a, s.user_b) then
    update public.speed_sessions set status = 'cancelled', ended_reason = 'blocked' where id = s.id;
    return private.speed_session_json(p_session, v_uid);
  end if;
  if v_uid = s.user_a then update public.speed_sessions set a_ready_at = coalesce(a_ready_at, now()) where id = s.id;
  else update public.speed_sessions set b_ready_at = coalesce(b_ready_at, now()) where id = s.id; end if;
  update public.speed_sessions set status = 'live', started_at = now(), ends_at = now() + make_interval(secs => v_secs)
   where id = s.id and a_ready_at is not null and b_ready_at is not null and status = 'pending';
  return private.speed_session_json(p_session, v_uid);
end;
$$;

/** Leave a pending/live date. Leaving early refunds the partner (≤ refund window) and costs you reputation. */
create or replace function private.speed_leave(p_session uuid, p_reason text default 'left')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  s public.speed_sessions;
  v_other uuid;
  v_refund integer := private.setting_num('speed_refund_seconds', 20)::integer;
begin
  perform private.speed_tick(p_session);
  select * into s from public.speed_sessions where id = p_session for update;
  if not found or v_uid not in (s.user_a, s.user_b) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  v_other := case when s.user_a = v_uid then s.user_b else s.user_a end;
  if s.status not in ('pending', 'live') then return private.speed_session_json(p_session, v_uid); end if;
  if s.user_a = v_uid then update public.speed_sessions set a_left_at = now() where id = s.id;
  else update public.speed_sessions set b_left_at = now() where id = s.id; end if;
  if s.status = 'pending' or now() < s.started_at + make_interval(secs => v_refund) then
    update public.speed_sessions set status = 'cancelled',
           ended_reason = case when p_reason = 'report' then 'reported' else 'partner_left_early' end where id = s.id;
    perform private.speed_refund_ticket(t.id, 'Speed date refund · partner left') from public.speed_tickets t
     where t.session_id = s.id and t.user_id = v_other;
    if p_reason = 'report' then
      -- reporting someone never costs you: refund the reporter too
      perform private.speed_refund_ticket(t.id, 'Speed date refund · reported') from public.speed_tickets t
       where t.session_id = s.id and t.user_id = v_uid;
    else
      perform private.speed_rep_bump(v_uid, 'early_leave');
    end if;
  else
    update public.speed_sessions set status = 'deciding', ends_at = least(ends_at, now()),
           ended_reason = case when p_reason = 'report' then 'reported' else 'ended_early' end where id = s.id;
    if p_reason <> 'report' and now() < s.ends_at - interval '30 seconds' then
      perform private.speed_rep_bump(v_uid, 'early_leave');
    end if;
  end if;
  return private.speed_session_json(p_session, v_uid);
end;
$$;

create or replace function private.speed_choose(p_session uuid, p_choice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  s public.speed_sessions;
  v_match uuid;
begin
  if p_choice not in ('match', 'pass') then raise exception 'invalid_choice' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('speed_choose', 30, interval '1 minute');
  perform private.speed_tick(p_session);
  select * into s from public.speed_sessions where id = p_session for update;
  if not found or v_uid not in (s.user_a, s.user_b) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if s.status <> 'deciding' then raise exception 'not_deciding' using errcode = 'P0001'; end if;
  if s.ended_reason = 'reported' then p_choice := 'pass'; end if;
  if s.user_a = v_uid then update public.speed_sessions set a_choice = coalesce(a_choice, p_choice) where id = s.id;
  else update public.speed_sessions set b_choice = coalesce(b_choice, p_choice) where id = s.id; end if;
  select * into s from public.speed_sessions where id = p_session;
  if s.a_choice is not null and s.b_choice is not null then
    if s.a_choice = 'match' and s.b_choice = 'match' and not public.is_blocked_either_way(s.user_a, s.user_b) then
      perform set_config('match.like_source', 'speed', true);
      insert into public.likes (liker_id, liked_id) values (s.user_a, s.user_b) on conflict do nothing;
      insert into public.likes (liker_id, liked_id) values (s.user_b, s.user_a) on conflict do nothing;
      perform set_config('match.like_source', '', true);
      select m.id into v_match from public.matches m where m.user_a = least(s.user_a, s.user_b) and m.user_b = greatest(s.user_a, s.user_b);
    end if;
    update public.speed_sessions set status = 'done', match_id = v_match,
           ended_reason = coalesce(ended_reason, 'completed') where id = s.id;
    perform private.speed_rep_bump(s.user_a, 'date');
    perform private.speed_rep_bump(s.user_b, 'date');
  end if;
  return private.speed_session_json(p_session, v_uid);
end;
$$;

/** LiveKit grant for the edge function: only the two people, only while the date can be live. */
create or replace function private.get_speed_token_grant(p_session uuid)
returns table (room text, identity uuid, display_name text, can_publish boolean, kind text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s public.speed_sessions;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('speed_token', 30, interval '1 minute');
  perform private.speed_tick(p_session);
  select * into s from public.speed_sessions where id = p_session;
  if not found or v_uid not in (s.user_a, s.user_b) or public.is_blocked_either_way(s.user_a, s.user_b) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if s.status not in ('pending', 'live') then raise exception 'call_ended' using errcode = 'P0001'; end if;
  return query select 'speed_' || s.id::text, v_uid, (select coalesce(p.name, 'Member') from public.profiles p where p.id = v_uid), true, 'video'::text;
end;
$$;

/** Global sweep (cron): stale queue entries are refunded, sessions advance by the clock. */
create or replace function private.speed_housekeeping()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in delete from public.speed_queue where last_seen_at < now() - interval '3 minutes' returning ticket_id loop
    update public.speed_tickets set status = 'cancelled' where id = r.ticket_id and coins = 0 and status = 'queued';
    perform private.speed_refund_ticket(r.ticket_id, 'Speed date · queue timed out');
  end loop;
  for r in select id from public.speed_sessions where status in ('pending', 'live', 'deciding') loop
    perform private.speed_tick(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants + wrappers
do $$
declare f text;
begin
  foreach f in array array[
    'private.speed_night_notify()', 'private.speed_free_left(uuid)', 'private.speed_refund_ticket(uuid, text)',
    'private.speed_rep_bump(uuid, text)', 'private.speed_eligible_block(uuid)',
    'private.speed_compatible(public.speed_queue, public.speed_queue)', 'private.speed_try_pair(uuid)',
    'private.speed_tick(uuid)', 'private.speed_session_json(uuid, uuid)', 'private.speed_housekeeping()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'private.speed_night_info()', 'private.speed_status()', 'private.speed_join(integer, integer, integer, boolean)',
    'private.speed_leave_queue()', 'private.speed_ready(uuid)', 'private.speed_leave(uuid, text)',
    'private.speed_choose(uuid, text)', 'private.get_speed_token_grant(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

create or replace function public.get_speed_night() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.speed_night_info() $$;
create or replace function public.speed_status() returns jsonb
language sql security invoker set search_path = '' as $$ select private.speed_status() $$;
create or replace function public.speed_join(p_min_age integer default 18, p_max_age integer default 99,
                                             p_max_km integer default null, p_same_intention boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.speed_join(p_min_age, p_max_age, p_max_km, p_same_intention) $$;
create or replace function public.speed_leave_queue() returns jsonb
language sql security invoker set search_path = '' as $$ select private.speed_leave_queue() $$;
create or replace function public.speed_ready(p_session uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.speed_ready(p_session) $$;
create or replace function public.speed_leave(p_session uuid, p_reason text default 'left') returns jsonb
language sql security invoker set search_path = '' as $$ select private.speed_leave(p_session, p_reason) $$;
create or replace function public.speed_choose(p_session uuid, p_choice text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.speed_choose(p_session, p_choice) $$;
create or replace function public.get_speed_token_grant(p_session uuid)
returns table (room text, identity uuid, display_name text, can_publish boolean, kind text)
language sql security invoker set search_path = '' as $$ select * from private.get_speed_token_grant(p_session) $$;

do $$
declare f text;
begin
  foreach f in array array['public.get_speed_night()', 'public.speed_status()',
    'public.speed_join(integer, integer, integer, boolean)', 'public.speed_leave_queue()', 'public.speed_ready(uuid)',
    'public.speed_leave(uuid, text)', 'public.speed_choose(uuid, text)', 'public.get_speed_token_grant(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- cron: queue/session sweep every minute; Speed Night push (then the system push sweep)
select cron.schedule('speed-housekeeping', '* * * * *', $cron$ select private.speed_housekeeping(); $cron$);
select cron.schedule('speed-night-push', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://pkpdheytmbwvqhpcaigm.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'match_cron_anon_key'), '')),
    body := '{"system_sweep": true}'::jsonb,
    timeout_milliseconds := 30000)
  where private.speed_night_notify() > 0;
$cron$);
