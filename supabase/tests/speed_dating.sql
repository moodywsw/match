-- Speed Dating 1:1: eligibility, free/paid tickets, mutual-preference pairing, blocks, token grant,
-- refunds (partner leaves early, no-show, leaving the queue), private choices → match, reputation, Speed Night.
-- Always raises SPEED_TESTS_PASSED so everything is rolled back.
do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  w1 uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); w3 uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); inc uuid := gen_random_uuid(); raw uuid := gen_random_uuid();
  j jsonb; s1 uuid; s2 uuid; s3 uuid; bal bigint; n int; log text := ''; t record;
begin
  -- clean slate for the shared queue (rolled back at the end)
  delete from public.speed_queue;
  update public.speed_sessions set status = 'done' where status in ('pending', 'live', 'deciding');

  insert into auth.users (id, email, aud, role)
  select x, x::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[m1, m2, w1, w2, w3, c, inc, raw]) x;
  insert into public.profiles (id, name, birth_date, gender, interested_in, onboarding_complete, is_discoverable, bio, intention)
  select x, nm, '1994-07-01', g, array[pref], true, true, 'Hi', 'serious'
    from (values (m1, 'Miguel', 'man', 'women'), (m2, 'Mário', 'man', 'women'), (w1, 'Wanda', 'woman', 'men'),
                 (w2, 'Wendy', 'woman', 'men'), (w3, 'Vera', 'woman', 'men'), (c, 'Clara', 'woman', 'men'),
                 (inc, 'Inês', 'woman', 'men'), (raw, 'Raul', 'man', 'women')) v(x, nm, g, pref);
  update public.profiles set bio = null where id = raw;                               -- incomplete
  insert into public.photos (user_id, url, position, is_primary)
  select x, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || x || '/1.jpg', 0, true
    from unnest(array[m1, m2, w1, w2, w3, c, inc]) x;
  insert into public.user_interests (user_id, interest_id)
  select x, i.id from unnest(array[m1, m2, w1, w2, w3, c, inc, raw]) x, (select id from public.interests order by id limit 3) i;
  insert into public.subscriptions (user_id, tier, store, status) values (inc, 'super_match', 'test_store', 'active');
  update public.profiles set incognito = true where id = inc;
  insert into public.blocks (blocker_id, blocked_id) values (m1, c);

  -- no direct table access
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform 1 from public.speed_sessions limit 1;
    assert false, 'sessions are private';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    insert into public.speed_queue (user_id, ticket_id) values (m1, gen_random_uuid());
    assert false, 'no queue writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;

  -- eligibility
  perform set_config('request.jwt.claims', json_build_object('sub', raw, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.speed_join(); assert false, 'incomplete';
  exception when assert_failure then raise; when others then assert sqlerrm = 'profile_incomplete', sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', inc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.speed_join(); assert false, 'incognito';
  exception when assert_failure then raise; when others then assert sqlerrm = 'incognito_speed', sqlerrm; end;
  reset role;
  log := log || ' eligibility';

  -- m1 queues (free), c (blocked by m1) queues → never paired with m1
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_join(18, 99, null, false);
  assert j->>'state' = 'queued' and not (j->>'free_today')::boolean, concat('m1 queued free ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_join();
  assert j->>'state' = 'queued', concat('blocked pair stays apart ', j);
  j := public.speed_leave_queue();
  assert j->>'state' = 'idle' and (j->>'free_today')::boolean, 'leaving the queue gives the free date back';
  reset role;
  log := log || ' blocks+queue-refund';

  -- w1 joins → paired with m1 (mutual gender prefs)
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_join(25, 40, 50, false);
  assert j->>'state' = 'session' and j->'session'->>'status' = 'pending', concat('paired ', j);
  s1 := (j->'session'->>'id')::uuid;
  assert j->'session'->'partner'->>'name' = 'Miguel' and j->'session'->>'icebreaker' is not null
         and j->'session'->>'shared_interest' is not null, 'before-the-call info';
  assert j->'session'->'partner' ? 'age' and not (j->'session'->'partner' ? 'city'), 'no location in session payload';
  select * into t from public.get_speed_token_grant(s1);
  assert t.room = 'speed_' || s1 and t.can_publish, 'token grant for the pair';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.get_speed_token_grant(s1); assert false, 'outsider token';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  begin perform public.speed_ready(s1); assert false, 'outsider ready';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  reset role;

  -- both ready → live with a 2-minute server timer
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_ready(s1);
  assert j->>'status' = 'pending' and (j->>'me_ready')::boolean and not (j->>'partner_ready')::boolean, 'waiting for partner';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_ready(s1);
  assert j->>'status' = 'live' and ((j->>'ends_at')::timestamptz - (j->>'started_at')::timestamptz) = interval '120 seconds', concat('live ', j);
  reset role;
  -- m1 leaves within 20 s → cancelled, w1 refunded (free date back), m1 early-leave strike
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_leave(s1);
  assert j->>'status' = 'cancelled', 'early leave cancels';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_status();
  assert j->'session'->>'ended_reason' = 'partner_left_early' and (j->'session'->>'refunded')::boolean
         and (j->>'free_today')::boolean, concat('partner refunded ', j);
  reset role;
  select early_leaves into n from public.speed_reputation where user_id = m1;
  assert n = 1, 'early leaver deprioritized';
  log := log || ' pair+ready+early-leave-refund';

  -- paid date: m1 already used today's free one → 50 coins; insufficient first
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.speed_join(); assert false, 'needs coins';
  exception when assert_failure then raise; when others then assert sqlerrm = 'insufficient_coins', sqlerrm; end;
  reset role;
  perform private.wallet_apply(m1, 'coins', 200, 'adjustment', null, null, null, null, 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_join();
  assert j->>'state' = 'queued' and (j->>'coins')::int = 150, concat('paid 50 ', j);
  reset role;
  -- w3 joins → m1 & w3; only m1 shows up → no-show: m1 refunded, w3 strike
  perform set_config('request.jwt.claims', json_build_object('sub', w3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_join();
  s3 := (j->'session'->>'id')::uuid;
  assert s3 is not null, 'w3 paired';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.speed_ready(s3);
  reset role;
  update public.speed_sessions set created_at = now() - interval '40 seconds' where id = s3;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_status();
  assert j->'session'->>'ended_reason' = 'no_show' and (j->'session'->>'refunded')::boolean and (j->>'coins')::int = 200, concat('no-show refund ', j);
  reset role;
  select no_shows into n from public.speed_reputation where user_id = w3;
  assert n = 1, 'no-show strike';
  log := log || ' paid+no-show-refund';

  -- m2 + w2: full date → private choices → mutual match
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.speed_join();
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_join();
  s2 := (j->'session'->>'id')::uuid;
  assert j->'session'->'partner'->>'name' = 'Mário', concat('m2-w2 ', j);
  perform public.speed_ready(s2);
  begin perform public.speed_choose(s2, 'match'); assert false, 'cannot choose before the date';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_deciding', sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.speed_ready(s2);
  reset role;
  update public.speed_sessions set started_at = now() - interval '121 seconds', ends_at = now() - interval '1 second' where id = s2;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_choose(s2, 'match');
  assert j->>'status' = 'deciding' and j->>'my_choice' = 'match' and j->>'outcome' is null, concat('waiting for partner ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.speed_status();
  assert j->'session'->>'my_choice' is null and j->'session'->>'outcome' is null, 'partner choice stays private';
  j := public.speed_choose(s2, 'match');
  assert j->>'status' = 'done' and j->>'outcome' = 'match' and j->>'match_id' is not null and j->>'conversation_id' is not null,
         concat('mutual → match ', j);
  reset role;
  select count(*) into n from public.matches where user_a = least(m2, w2) and user_b = greatest(m2, w2);
  assert n = 1, 'match row';
  log := log || ' private-choices+match';

  -- Speed Dating Night = next/current Friday 21:00 Lisbon
  j := private.speed_night_info();
  assert extract(dow from ((j->>'starts_at')::timestamptz at time zone 'Europe/Lisbon')) = 5
     and extract(hour from ((j->>'starts_at')::timestamptz at time zone 'Europe/Lisbon')) = 21, concat('night ', j);
  log := log || ' speed-night';

  raise exception 'SPEED_TESTS_PASSED:%', log;
end $$;
