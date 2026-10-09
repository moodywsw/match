-- Wallet overview/history, 1-day hosting rule, daily streak, referrals, completeness meter, coin boosts.
-- Always raises WALLET_GROWTH_PASSED at the end so everything is rolled back.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  j jsonb; n int; bal bigint; v_code text; log text := ''; t text;
begin
  insert into auth.users (id, email, aud, role)
  select x, x::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[a, b, c]) x;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable)
  select x, nm, '1994-07-01', true, true from (values (a, 'Ana'), (b, 'Bruno'), (c, 'Carla')) v(x, nm);
  update public.profiles set created_at = now() - interval '30 days' where id = c;

  -- 1-day hosting rule
  assert private.setting_num('live_host_min_account_days', 7) = 1, 'host min days is 1';
  update public.profiles set bio = 'Hi', intention = 'serious' where id = any(array[a, c]);
  insert into public.photos (user_id, url, position, is_primary)
  select x, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || x || '/1.jpg', 0, true from unnest(array[a, c]) x;
  insert into public.user_interests (user_id, interest_id)
  select x, i.id from unnest(array[a, c]) x, (select id from public.interests order by id limit 3) i on conflict do nothing;
  assert private.live_host_block(a) = 'account_too_new', 'brand-new account cannot host';
  update public.profiles set created_at = now() - interval '25 hours' where id = a;
  assert private.live_host_block(a) is null, concat('1-day-old account can host: ', private.live_host_block(a));
  update public.profiles set created_at = now() where id = a;
  log := log || ' host-1-day';

  -- lockdown: no client writes on the new tables
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.daily_rewards (user_id, day, streak, coins) values (a, current_date, 1, 999);
    assert false, 'no client daily_rewards writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    insert into public.referrals (invitee_id, referrer_id) values (a, b);
    assert false, 'no client referral writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    insert into public.referral_codes (user_id, code) values (a, 'HACKED');
    assert false, 'no client code writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    perform private.referral_try_reward(a);
    assert false, 'reward helper is private';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  log := log || ' lockdown';

  -- daily streak
  j := public.get_daily_reward();
  assert not (j->>'claimed_today')::boolean and (j->>'today_coins')::int = 5, concat('status ', j);
  j := public.claim_daily_reward();
  assert (j->>'claimed')::boolean and (j->>'coins')::int = 5 and (j->>'streak')::int = 1, concat('claim ', j);
  j := public.claim_daily_reward();
  assert not (j->>'claimed')::boolean and (j->>'already')::boolean, 'one claim per day';
  reset role;
  select coins into bal from public.wallets where user_id = a;
  assert bal = 5, concat('streak balance=', bal);
  insert into public.daily_rewards (user_id, day, streak, coins)
  select c, private.lisbon_today() - d, 7 - d, 5 from generate_series(1, 6) d;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.claim_daily_reward();
  assert (j->>'streak')::int = 7 and (j->>'coins')::int = 25, concat('day 7 bonus ', j);
  reset role;
  insert into public.daily_rewards (user_id, day, streak, coins) values (b, private.lisbon_today() - 2, 4, 5);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_daily_reward();
  assert (j->>'streak')::int = 0 and (j->>'day_in_week')::int = 1, concat('missed day resets ', j);
  reset role;
  log := log || ' streak';

  -- referrals
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_my_referral();
  v_code := j->>'code';
  assert v_code ~ '^[A-Z2-9]{6}$' and (j->>'coins')::int = 50, concat('code ', j);
  assert public.get_my_referral()->>'code' = v_code, 'code is stable';
  begin
    perform public.redeem_referral(v_code);
    assert false, 'own code';
  exception when assert_failure then raise; when others then assert sqlerrm = 'own_code', sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_referral('NOPE99');
    assert false, 'bad code';
  exception when assert_failure then raise; when others then assert sqlerrm = 'invalid_code', sqlerrm; end;
  j := public.redeem_referral(lower(v_code));
  assert (j->>'ok')::boolean and not (j->>'rewarded')::boolean, concat('pending until complete ', j);
  begin
    perform public.redeem_referral(v_code);
    assert false, 'only once';
  exception when assert_failure then raise; when others then assert sqlerrm = 'already_redeemed', sqlerrm; end;
  reset role;
  select coalesce(sum(coins), 0) into bal from public.wallets where user_id = b;
  assert bal = 0, 'no reward before profile is complete';
  -- b completes the profile → triggers pay both sides
  update public.profiles set bio = 'New here', intention = 'serious' where id = b;
  insert into public.photos (user_id, url, position, is_primary)
  values (b, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || b || '/1.jpg', 0, true);
  insert into public.user_interests (user_id, interest_id)
  select b, i.id from (select id from public.interests order by id limit 3) i on conflict do nothing;
  select coins into bal from public.wallets where user_id = b;
  assert bal = 50, concat('invitee paid=', bal);
  select coins into bal from public.wallets where user_id = a;
  assert bal = 55, concat('inviter paid=', bal);
  select count(*) into n from public.notifications where user_id = a and type = 'reward' and actor_id = b;
  assert n = 1, 'inviter notified';
  update public.profiles set bio = 'Edited' where id = b;
  select coins into bal from public.wallets where user_id = a;
  assert bal = 55, 'paid only once';
  -- c's account is 30 days old → window closed; a inviting back b is circular
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_referral(v_code);
    assert false, 'window';
  exception when assert_failure then raise; when others then assert sqlerrm = 'redeem_window_closed', sqlerrm; end;
  assert not (public.get_my_referral()->>'can_redeem')::boolean, 'old account cannot redeem';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.get_my_referral()->>'code';
  j := public.get_my_referral();
  assert (j->'redeemed'->>'rewarded')::boolean and j->'redeemed'->>'referrer_name' = 'Ana', concat('invitee view ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_referral(t);
    assert false, 'circular';
  exception when assert_failure then raise; when others then assert sqlerrm = 'invalid_code', sqlerrm; end;
  j := public.get_my_referral();
  assert (j->>'invited')::int = 1 and (j->>'rewarded')::int = 1, concat('inviter stats ', j);
  -- a sees only own/own-side referral rows
  select count(*) into n from public.referrals;
  assert n = 1, 'referral rows visible to the parties';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.referrals;
  assert n = 0, 'outsiders see no referrals';
  select count(*) into n from public.wallet_transactions where user_id = a;
  assert n = 0, 'outsiders see no ledger';
  reset role;
  log := log || ' referral';

  -- completeness
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_profile_completeness();
  assert (j->>'score')::int = 65 and jsonb_array_length(j->'items') = 7 and (j->>'live_ready')::boolean, concat('completeness ', j);
  reset role;
  update public.profiles set friday_answer = 'Tascas and fado', city = 'Lisboa' where id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (public.get_profile_completeness()->>'score')::int = 90, 'friday + city';
  reset role;
  log := log || ' completeness';

  -- boost with coins
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.activate_boost_with_coins();
    assert false, 'needs coins';
  exception when assert_failure then raise; when others then assert sqlerrm = 'insufficient_coins', sqlerrm; end;
  reset role;
  perform private.wallet_apply(a, 'coins', 200, 'adjustment', null, null, null, null, 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.activate_boost_with_coins();
  assert (j->>'balance')::bigint = 105 and (j->>'price')::int = 150, concat('boost ', j);
  begin
    perform public.activate_boost_with_coins();
    assert false, 'one at a time';
  exception when assert_failure then raise; when others then assert sqlerrm = 'boost_active', sqlerrm; end;
  select used_this_month into n from public.get_boost_status();
  assert n = 0, 'coin boost does not use the MATCH+ monthly boost';
  reset role;
  select coins into bal from public.wallets where user_id = a;
  assert bal = 105, 'failed boost charged nothing';
  update public.profiles set is_discoverable = false where id = c;
  perform private.wallet_apply(c, 'coins', 500, 'adjustment', null, null, null, null, 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.activate_boost_with_coins();
    assert false, 'hidden from discover';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_discoverable', sqlerrm; end;
  reset role;
  log := log || ' boost';

  -- overview + history
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_wallet_overview();
  assert (j->>'coins')::int = 105 and jsonb_array_length(j->'packs') = 3 and j->'packs'->0->>'reference_price' = '€0.99'
         and not (j->>'is_admin')::boolean, concat('overview ', j);
  select string_agg(title, '|' order by created_at) into t from public.get_wallet_history(50, null);
  assert t like '%Daily streak · day 1%' and t like '%Invite bonus · Bruno joined%' and t like '%Boost · 30 min%', concat('history ', t);
  select count(*) into n from public.get_wallet_history(50, null) h where h.kind = 'boost' and h.amount = -150 and h.emoji = '⚡';
  assert n = 1, 'boost row';
  reset role;
  log := log || ' wallet-history';

  raise exception 'WALLET_GROWTH_PASSED:%', log;
end $$;
