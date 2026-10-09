-- Wallet as a first-class feature + growth/retention:
--   * live hosting minimum account age 7 → 1 day
--   * coin pack pricing metadata, wallet overview + readable history (gift names, counterparts)
--   * daily login streak (small coin rewards, Lisbon calendar days)
--   * referral codes (coins for both once the invitee completes their profile)
--   * profile completeness checklist (server-computed meter + nudges)
--   * boost with coins (separate from the MATCH+ monthly boost quota)
-- Coins are only ever bought through store IAP (RevenueCat consumables → webhook) or granted by
-- these server rules; there is no cash-out and no transfer between users.

-- ---------------------------------------------------------------------------
-- settings
update public.app_settings set value = '1',
  description = 'Accounts must be at least this many days old to go live (admins exempt for QA/moderation)'
 where key = 'live_host_min_account_days';
insert into public.app_settings (key, value, description) values
  ('live_host_min_account_days', '1', 'Accounts must be at least this many days old to go live (admins exempt for QA/moderation)'),
  ('streak_daily_coins', '5', 'Daily check-in reward (coins) for days 1-6 of a streak week'),
  ('streak_day7_coins', '25', 'Daily check-in reward (coins) on day 7 of a streak week'),
  ('referral_coins', '50', 'Coins for BOTH inviter and invitee once the invitee completes their profile'),
  ('referral_max_rewards', '20', 'Max rewarded invites per inviter (abuse cap)'),
  ('referral_redeem_days', '7', 'An invite code can be entered only within this many days of signing up'),
  ('boost_coin_price', '150', 'Coins for one 30-minute boost bought with coins'),
  ('boost_minutes', '30', 'Length of a boost in minutes')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- ledger kinds + notification type
alter table public.wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('purchase', 'purchase_reversal', 'gift_sent', 'gift_received', 'adjustment', 'reward', 'boost'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'match', 'message', 'post_like', 'comment', 'story_reply', 'super_like', 'story_like', 'event_update',
  'event_cancelled', 'missed_call', 'gift', 'chat_nudge', 'match_expiring', 'match_expired', 'match_extended',
  'we_met', 'date_feedback', 'reward']));

-- ---------------------------------------------------------------------------
-- coin pack pricing (store price wins; reference shown when the store can't be reached)
alter table public.coin_packs add column if not exists reference_price text
  check (reference_price is null or char_length(reference_price) <= 16);
alter table public.coin_packs add column if not exists bonus_pct integer not null default 0
  check (bonus_pct between 0 and 100);
update public.coin_packs set reference_price = '€0.99', bonus_pct = 0 where product_id = 'coins_100';
update public.coin_packs set reference_price = '€4.99', bonus_pct = 10 where product_id = 'coins_550';
update public.coin_packs set reference_price = '€9.99', bonus_pct = 20 where product_id = 'coins_1200';

create or replace function private.lisbon_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Lisbon')::date;
$$;
revoke all on function private.lisbon_today() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- wallet overview + history
create or replace function private.get_wallet_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); w public.wallets;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into w from public.wallets where user_id = v_uid;
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'diamonds', coalesce(w.diamonds, 0),
    'is_admin', coalesce((select p.is_admin from public.profiles p where p.id = v_uid), false),
    'boost_coin_price', private.setting_num('boost_coin_price', 150),
    'boost_minutes', private.setting_num('boost_minutes', 30),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('product_id', c.product_id, 'coins', c.coins,
                         'reference_price', c.reference_price, 'bonus_pct', c.bonus_pct) order by c.sort)
                       from public.coin_packs c where c.active), '[]'::jsonb));
end;
$$;

create or replace function private.get_wallet_history(p_limit integer default 50, p_before timestamptz default null)
returns table (id uuid, currency text, amount bigint, balance_after bigint, kind text, title text, subtitle text,
               emoji text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.currency, t.amount, t.balance_after, t.kind,
    case t.kind
      when 'purchase' then coalesce(c.coins::text || ' coin pack', 'Coin pack')
      when 'purchase_reversal' then 'Store refund'
      when 'gift_sent' then 'Sent ' || coalesce(g.name, 'a gift') || coalesce(' ×' || nullif(e.quantity, 1)::text, '')
      when 'gift_received' then 'Received ' || coalesce(g.name, 'a gift') || coalesce(' ×' || nullif(e.quantity, 1)::text, '')
      when 'reward' then coalesce(t.note, 'Reward')
      when 'boost' then coalesce(t.note, 'Boost')
      else coalesce(t.note, 'Adjustment')
    end,
    case t.kind
      when 'gift_sent' then 'to ' || case when e.receiver_id is null or public.is_blocked_either_way(t.user_id, e.receiver_id)
                                         then 'a member' else coalesce(pr.name, 'a member') end || ' · live'
      when 'gift_received' then 'from ' || case when e.sender_id is null or public.is_blocked_either_way(t.user_id, e.sender_id)
                                         then 'a member' else coalesce(ps.name, 'a member') end || ' · live'
      when 'purchase' then case when t.environment = 'SANDBOX' then 'Store purchase · test' else 'Store purchase' end
      when 'purchase_reversal' then 'Refunded by the store'
      else null
    end,
    case t.kind
      when 'purchase' then '🪙' when 'purchase_reversal' then '↩️'
      when 'gift_sent' then coalesce(g.emoji, '🎁') when 'gift_received' then coalesce(g.emoji, '🎁')
      when 'reward' then case when t.note ilike '%invite%' then '💌' else '🔥' end
      when 'boost' then '⚡' else '🛠️'
    end,
    t.created_at
  from public.wallet_transactions t
  left join public.gift_events e on e.id = t.gift_event_id
  left join public.gifts g on g.id = e.gift_id
  left join public.profiles pr on pr.id = e.receiver_id
  left join public.profiles ps on ps.id = e.sender_id
  left join public.coin_packs c on c.product_id = t.product_id
  where t.user_id = (select auth.uid())
    and (p_before is null or t.created_at < p_before)
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- daily streak
create table if not exists public.daily_rewards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  streak integer not null check (streak >= 1),
  coins integer not null check (coins >= 0),
  claimed_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.daily_rewards enable row level security;
revoke all on public.daily_rewards from anon, authenticated;
grant select on public.daily_rewards to authenticated;
drop policy if exists "own daily rewards" on public.daily_rewards;
create policy "own daily rewards" on public.daily_rewards for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.streak_coins(p_streak integer)
returns integer language sql stable security definer set search_path = '' as $$
  select case when ((p_streak - 1) % 7) + 1 = 7
              then private.setting_num('streak_day7_coins', 25)::integer
              else private.setting_num('streak_daily_coins', 5)::integer end;
$$;

create or replace function private.get_daily_reward()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := private.lisbon_today();
  v_today_streak integer;
  v_prev integer;
  v_streak integer;
  v_next integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select streak into v_today_streak from public.daily_rewards where user_id = v_uid and day = v_today;
  select streak into v_prev from public.daily_rewards where user_id = v_uid and day = v_today - 1;
  v_streak := coalesce(v_today_streak, v_prev, 0);
  v_next := coalesce(v_today_streak, coalesce(v_prev, 0) + 1);
  return jsonb_build_object(
    'claimed_today', v_today_streak is not null,
    'streak', v_streak,
    'day_in_week', ((v_next - 1) % 7) + 1,
    'today_coins', private.streak_coins(v_next),
    'tomorrow_coins', private.streak_coins(v_next + 1),
    'schedule', (select jsonb_agg(private.streak_coins(d)) from generate_series(1, 7) d),
    'eligible', exists (select 1 from public.profiles p where p.id = v_uid and p.onboarding_complete and p.hidden_at is null));
end;
$$;

create or replace function private.claim_daily_reward()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := private.lisbon_today();
  v_prev integer;
  v_streak integer;
  v_coins integer;
  v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.onboarding_complete and p.hidden_at is null) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('daily:' || v_uid::text));
  if exists (select 1 from public.daily_rewards where user_id = v_uid and day = v_today) then
    return private.get_daily_reward() || jsonb_build_object('claimed', false, 'already', true);
  end if;
  perform private.hit_rate_limit('daily_claim', 10, interval '1 hour');
  select streak into v_prev from public.daily_rewards where user_id = v_uid and day = v_today - 1;
  v_streak := coalesce(v_prev, 0) + 1;
  v_coins := private.streak_coins(v_streak);
  insert into public.daily_rewards (user_id, day, streak, coins) values (v_uid, v_today, v_streak, v_coins);
  v_bal := private.wallet_apply(v_uid, 'coins', v_coins, 'reward', null, null, null, null,
                                'Daily streak · day ' || v_streak);
  perform private.referral_try_reward(v_uid);
  return private.get_daily_reward() || jsonb_build_object('claimed', true, 'coins', v_coins, 'balance', v_bal);
end;
$$;

-- ---------------------------------------------------------------------------
-- referrals
create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{6,10}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  invitee_id uuid primary key references public.profiles(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  referrer_paid boolean not null default false,
  check (invitee_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, created_at desc);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
revoke all on public.referral_codes, public.referrals from anon, authenticated;
grant select on public.referral_codes, public.referrals to authenticated;
drop policy if exists "own referral code" on public.referral_codes;
create policy "own referral code" on public.referral_codes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own referrals" on public.referrals;
create policy "own referrals" on public.referrals for select to authenticated
  using ((select auth.uid()) in (invitee_id, referrer_id));

create or replace function private.ensure_referral_code(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text; v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i integer;
begin
  select code into v_code from public.referral_codes where user_id = p_user;
  if v_code is not null then return v_code; end if;
  for attempt in 1..20 loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1);
    end loop;
    begin
      insert into public.referral_codes (user_id, code) values (p_user, v_code);
      return v_code;
    exception when unique_violation then
      select code into v_code from public.referral_codes where user_id = p_user;
      if v_code is not null then return v_code; end if;
    end;
  end loop;
  raise exception 'code_generation_failed' using errcode = 'P0001';
end;
$$;

/** Pays both sides once the invitee's profile is complete. Safe to call often (no-op otherwise). */
create or replace function private.referral_try_reward(p_invitee uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals;
  v_coins integer := private.setting_num('referral_coins', 50)::integer;
  v_paid_count integer;
  v_pay_referrer boolean;
  v_name text;
begin
  select * into r from public.referrals where invitee_id = p_invitee and rewarded_at is null for update skip locked;
  if not found then return false; end if;
  if cardinality(private.live_missing(p_invitee)) > 0 then return false; end if;
  if exists (select 1 from public.profiles p where p.id = p_invitee and p.hidden_at is not null) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('referrer:' || r.referrer_id::text));
  select count(*) into v_paid_count from public.referrals where referrer_id = r.referrer_id and referrer_paid;
  v_pay_referrer := v_paid_count < private.setting_num('referral_max_rewards', 20)
    and exists (select 1 from public.profiles p where p.id = r.referrer_id and p.hidden_at is null);
  update public.referrals set rewarded_at = now(), referrer_paid = v_pay_referrer where invitee_id = p_invitee;
  perform private.wallet_apply(p_invitee, 'coins', v_coins, 'reward', null, null, null, null, 'Invite bonus · welcome');
  if v_pay_referrer then
    select name into v_name from public.profiles where id = p_invitee;
    perform private.wallet_apply(r.referrer_id, 'coins', v_coins, 'reward', null, null, null, null,
                                 left('Invite bonus · ' || coalesce(v_name, 'a friend') || ' joined', 200));
    insert into public.notifications (user_id, actor_id, type, payload)
    values (r.referrer_id, p_invitee, 'reward', jsonb_build_object('kind', 'referral', 'coins', v_coins));
  end if;
  return true;
end;
$$;

create or replace function private.get_my_referral()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
  mine public.referrals;
  v_created timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform private.referral_try_reward(v_uid);
  v_code := private.ensure_referral_code(v_uid);
  select * into mine from public.referrals where invitee_id = v_uid;
  select created_at into v_created from public.profiles where id = v_uid;
  return jsonb_build_object(
    'code', v_code,
    'coins', private.setting_num('referral_coins', 50),
    'invited', (select count(*) from public.referrals where referrer_id = v_uid),
    'rewarded', (select count(*) from public.referrals where referrer_id = v_uid and referrer_paid),
    'max_rewards', private.setting_num('referral_max_rewards', 20),
    'can_redeem', mine.invitee_id is null
                  and v_created > now() - make_interval(days => private.setting_num('referral_redeem_days', 7)::integer),
    'redeemed', case when mine.invitee_id is null then null else jsonb_build_object(
                  'referrer_name', (select name from public.profiles where id = mine.referrer_id),
                  'rewarded', mine.rewarded_at is not null,
                  'missing', to_jsonb(private.live_missing(v_uid))) end);
end;
$$;

create or replace function private.redeem_referral(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_ref uuid;
  v_created timestamptz;
  v_paid boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform private.hit_rate_limit('referral_redeem', 10, interval '1 hour');
  select user_id into v_ref from public.referral_codes where code = upper(btrim(coalesce(p_code, '')));
  if v_ref is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  if v_ref = v_uid then raise exception 'own_code' using errcode = 'P0001'; end if;
  if exists (select 1 from public.referrals where invitee_id = v_uid) then
    raise exception 'already_redeemed' using errcode = 'P0001';
  end if;
  select created_at into v_created from public.profiles where id = v_uid;
  if v_created is null or v_created < now() - make_interval(days => private.setting_num('referral_redeem_days', 7)::integer) then
    raise exception 'redeem_window_closed' using errcode = 'P0001';
  end if;
  if public.is_blocked_either_way(v_uid, v_ref) then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  -- no circular invites (A invites B, B invites A)
  if exists (select 1 from public.referrals where invitee_id = v_ref and referrer_id = v_uid) then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  insert into public.referrals (invitee_id, referrer_id) values (v_uid, v_ref);
  v_paid := private.referral_try_reward(v_uid);
  return jsonb_build_object('ok', true, 'rewarded', v_paid,
    'coins', private.setting_num('referral_coins', 50),
    'referrer_name', (select name from public.profiles where id = v_ref),
    'missing', to_jsonb(private.live_missing(v_uid)));
end;
$$;

-- reward as soon as the profile becomes complete (photo, interests, profile edits)
create or replace function private.referral_profile_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  -- NEW has different columns per table: never reference a field the table doesn't have
  if tg_table_name = 'profiles' then
    v_user := (to_jsonb(new) ->> 'id')::uuid;
  else
    v_user := (to_jsonb(new) ->> 'user_id')::uuid;
  end if;
  if exists (select 1 from public.referrals where invitee_id = v_user and rewarded_at is null) then
    perform private.referral_try_reward(v_user);
  end if;
  return null;
end;
$$;
drop trigger if exists referral_reward_profiles on public.profiles;
create trigger referral_reward_profiles after update of bio, intention, name, onboarding_complete, verified on public.profiles
  for each row execute function private.referral_profile_trigger();
drop trigger if exists referral_reward_photos on public.photos;
create trigger referral_reward_photos after insert on public.photos
  for each row execute function private.referral_profile_trigger();
drop trigger if exists referral_reward_interests on public.user_interests;
create trigger referral_reward_interests after insert on public.user_interests
  for each row execute function private.referral_profile_trigger();

-- ---------------------------------------------------------------------------
-- profile completeness checklist
create or replace function private.get_profile_completeness()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles;
  v_photos integer;
  v_interests integer;
  v_items jsonb;
  v_score integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into p from public.profiles where id = v_uid;
  select count(*) into v_photos from public.photos where user_id = v_uid;
  select count(*) into v_interests from public.user_interests where user_id = v_uid;
  v_items := jsonb_build_array(
    jsonb_build_object('key', 'photo', 'label', 'Add a profile photo', 'weight', 25, 'done', v_photos >= 1,
                       'hint', 'Profiles with a photo get far more likes'),
    jsonb_build_object('key', 'bio', 'label', 'Write a short bio', 'weight', 15, 'done', coalesce(btrim(p.bio), '') <> '',
                       'hint', 'Two lines about you is enough'),
    jsonb_build_object('key', 'interests', 'label', 'Pick 3+ interests', 'weight', 15, 'done', v_interests >= 3,
                       'hint', 'Interests power daily picks and "why you match"'),
    jsonb_build_object('key', 'friday', 'label', 'Answer the Friday question', 'weight', 15,
                       'done', coalesce(btrim(p.friday_answer), '') <> '', 'hint', 'The best conversation starter on MATCH'),
    jsonb_build_object('key', 'intention', 'label', 'Say what you''re looking for', 'weight', 10, 'done', p.intention is not null,
                       'hint', 'Matches with the same intention go further'),
    jsonb_build_object('key', 'photos3', 'label', 'Add 3 or more photos', 'weight', 10, 'done', v_photos >= 3,
                       'hint', 'Show a bit more of your life'),
    jsonb_build_object('key', 'city', 'label', 'Add your city', 'weight', 10, 'done', coalesce(btrim(p.city), '') <> '',
                       'hint', 'Helps people and events near you find you'));
  select coalesce(sum((i->>'weight')::integer), 0) into v_score from jsonb_array_elements(v_items) i where (i->>'done')::boolean;
  return jsonb_build_object('score', v_score, 'items', v_items,
    'live_ready', cardinality(private.live_missing(v_uid)) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- boost with coins (MATCH+ monthly quota counts plan boosts only)
alter table public.boosts add column if not exists source text not null default 'plan' check (source in ('plan', 'coins'));

create or replace function private.boost_status()
returns table (active_until timestamptz, used_this_month integer, monthly_quota integer)
language sql stable security definer set search_path = '' as $$
  select
    (select max(b.ends_at) from public.boosts b where b.user_id = (select auth.uid()) and b.ends_at > now()),
    (select count(*)::int from public.boosts b where b.user_id = (select auth.uid()) and b.source = 'plan'
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
   where user_id = v_me and source = 'plan'
     and starts_at >= date_trunc('month', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon';
  if v_used >= private.boost_quota(v_me) then
    raise exception 'boost_quota' using errcode = 'P0001', hint = 'Your monthly boost is used — it resets on the 1st';
  end if;
  insert into public.boosts (user_id, ends_at, source) values (v_me, now() + interval '30 minutes', 'plan') returning ends_at into v_end;
  return v_end;
end;
$$;

create or replace function private.activate_boost_with_coins()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_price integer := private.setting_num('boost_coin_price', 150)::integer;
  v_minutes integer := private.setting_num('boost_minutes', 30)::integer;
  v_end timestamptz;
  v_bal bigint;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_me and p.onboarding_complete and p.hidden_at is null) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_me and (p.incognito or not p.is_discoverable)) then
    raise exception 'not_discoverable' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('boost:' || v_me::text));
  if exists (select 1 from public.boosts where user_id = v_me and ends_at > now()) then
    raise exception 'boost_active' using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('boost_coins', 6, interval '1 day');
  v_bal := private.wallet_apply(v_me, 'coins', -v_price, 'boost', null, null, null, null,
                                'Boost · ' || v_minutes || ' min');
  insert into public.boosts (user_id, ends_at, source) values (v_me, now() + make_interval(mins => v_minutes), 'coins')
  returning ends_at into v_end;
  return jsonb_build_object('ends_at', v_end, 'balance', v_bal, 'price', v_price);
end;
$$;

-- ---------------------------------------------------------------------------
-- grants + public wrappers
revoke all on function private.get_wallet_overview() from public, anon;
revoke all on function private.get_wallet_history(integer, timestamptz) from public, anon;
revoke all on function private.streak_coins(integer) from public, anon, authenticated;
revoke all on function private.get_daily_reward() from public, anon;
revoke all on function private.claim_daily_reward() from public, anon;
revoke all on function private.ensure_referral_code(uuid) from public, anon, authenticated;
revoke all on function private.referral_try_reward(uuid) from public, anon, authenticated;
revoke all on function private.get_my_referral() from public, anon;
revoke all on function private.redeem_referral(text) from public, anon;
revoke all on function private.referral_profile_trigger() from public, anon, authenticated;
revoke all on function private.get_profile_completeness() from public, anon;
revoke all on function private.activate_boost_with_coins() from public, anon;
grant execute on function private.get_wallet_overview(), private.get_wallet_history(integer, timestamptz),
  private.get_daily_reward(), private.claim_daily_reward(), private.get_my_referral(), private.redeem_referral(text),
  private.get_profile_completeness(), private.activate_boost_with_coins() to authenticated;

create or replace function public.get_wallet_overview() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.get_wallet_overview() $$;
create or replace function public.get_wallet_history(p_limit integer default 50, p_before timestamptz default null)
returns table (id uuid, currency text, amount bigint, balance_after bigint, kind text, title text, subtitle text, emoji text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.get_wallet_history(p_limit, p_before) $$;
create or replace function public.get_daily_reward() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.get_daily_reward() $$;
create or replace function public.claim_daily_reward() returns jsonb
language sql security invoker set search_path = '' as $$ select private.claim_daily_reward() $$;
create or replace function public.get_my_referral() returns jsonb
language sql security invoker set search_path = '' as $$ select private.get_my_referral() $$;
create or replace function public.redeem_referral(p_code text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.redeem_referral(p_code) $$;
create or replace function public.get_profile_completeness() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.get_profile_completeness() $$;
create or replace function public.activate_boost_with_coins() returns jsonb
language sql security invoker set search_path = '' as $$ select private.activate_boost_with_coins() $$;

revoke all on function public.get_wallet_overview(), public.get_wallet_history(integer, timestamptz),
  public.get_daily_reward(), public.claim_daily_reward(), public.get_my_referral(), public.redeem_referral(text),
  public.get_profile_completeness(), public.activate_boost_with_coins() from public, anon;
grant execute on function public.get_wallet_overview(), public.get_wallet_history(integer, timestamptz),
  public.get_daily_reward(), public.claim_daily_reward(), public.get_my_referral(), public.redeem_referral(text),
  public.get_profile_completeness(), public.activate_boost_with_coins() to authenticated;
