-- Group dating rooms: lockdown, eligibility, roulette by mutual preferences, blocks, interests rooms,
-- friends rooms (matches-only invites + notification), live → picking → private mutual picks → matches,
-- token grant, capacity. Always raises GROUP_TESTS_PASSED so everything is rolled back.
do $$
declare
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); w1 uuid := gen_random_uuid(); w2 uuid := gen_random_uuid();
  gw uuid := gen_random_uuid(); blk uuid := gen_random_uuid(); inc uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  j jsonb; r1 uuid; r2 uuid; r3 uuid; v_int integer; n integer; t record; log text := '';
begin
  update public.group_rooms set status = 'done' where status in ('open', 'live', 'picking');

  insert into auth.users (id, email, aud, role)
  select x, x::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[m1, m2, w1, w2, gw, blk, inc, stranger]) x;
  insert into public.profiles (id, name, birth_date, gender, interested_in, onboarding_complete, is_discoverable, bio, intention)
  select x, nm, '1994-07-01', g, array[pref], true, true, 'Hi', 'serious'
    from (values (m1, 'Gil', 'man', 'women'), (m2, 'Hugo', 'man', 'women'), (w1, 'Ana', 'woman', 'men'),
                 (w2, 'Bea', 'woman', 'men'), (gw, 'Gabi', 'woman', 'women'), (blk, 'Blake', 'woman', 'men'),
                 (inc, 'Iris', 'woman', 'men'), (stranger, 'Sam', 'woman', 'men')) v(x, nm, g, pref);
  insert into public.photos (user_id, url, position, is_primary)
  select x, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || x || '/1.jpg', 0, true
    from unnest(array[m1, m2, w1, w2, gw, blk, inc, stranger]) x;
  insert into public.user_interests (user_id, interest_id)
  select x, i.id from unnest(array[m1, m2, w1, w2, gw, blk, inc, stranger]) x, (select id from public.interests order by id limit 3) i;
  select min(id) into v_int from public.interests;
  insert into public.subscriptions (user_id, tier, store, status) values (inc, 'super_match', 'test_store', 'active');
  update public.profiles set incognito = true where id = inc;
  insert into public.blocks (blocker_id, blocked_id) values (m1, blk);

  -- lockdown
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from public.group_picks limit 1; assert false, 'picks private';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin perform 1 from public.group_members limit 1; assert false, 'members private';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin perform public.group_join('nope'); assert false, 'mode';
  exception when assert_failure then raise; when others then assert sqlerrm = 'invalid_mode', sqlerrm; end;
  -- roulette: m1 opens a room
  j := public.group_join('roulette', null, 18, 99, null);
  r1 := (j->>'id')::uuid;
  assert j->>'status' = 'open' and j->>'mode' = 'roulette' and jsonb_array_length(j->'members') = 1, concat('open ', j);
  begin perform public.group_join('roulette'); assert false, 'one room at a time';
  exception when assert_failure then raise; when others then assert sqlerrm = 'already_in_room', sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', inc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.group_join('roulette'); assert false, 'incognito';
  exception when assert_failure then raise; when others then assert sqlerrm = 'incognito_group', sqlerrm; end;
  reset role;
  -- blk (blocked by m1) never lands in m1's room; gw (women→women) isn't compatible with m1 → own room
  perform set_config('request.jwt.claims', json_build_object('sub', blk, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_join('roulette');
  assert (j->>'id')::uuid <> r1, 'blocked person gets another room';
  perform public.group_leave((j->>'id')::uuid);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', gw, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_join('roulette');
  assert (j->>'id')::uuid <> r1, 'preferences respected';
  perform public.group_leave((j->>'id')::uuid);
  reset role;
  log := log || ' lockdown+eligibility+blocks+prefs';

  -- w1, w2 join → 3 people → live; m2 joins live room
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_join('roulette', null, 25, 45, 100);
  assert (j->>'id')::uuid = r1, concat('w1 into r1 ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_join('roulette');
  assert (j->>'id')::uuid = r1 and j->>'status' = 'live' and (j->>'ends_at')::timestamptz > now() + interval '9 minutes', concat('live ', j);
  select * into t from public.get_group_token_grant(r1);
  assert t.room = 'group_' || r1 and t.can_publish and t.kind = 'video', 'token';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_join('roulette');
  assert (j->>'id')::uuid = r1 and jsonb_array_length(j->'members') = 4, concat('m2 joins live room ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.get_group_token_grant(r1); assert false, 'outsider token';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  begin perform public.group_status(r1); assert false, 'outsider status';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  reset role;
  log := log || ' roulette-live+token';

  -- picks only in the picking phase
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.group_pick(r1, array[w1]); assert false, 'too early';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_picking', sqlerrm; end;
  reset role;
  update public.group_rooms set ends_at = now() - interval '1 second' where id = r1;
  -- m1 likes w1 + w2; w1 likes m1; w2 likes m2; m2 likes nobody
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_pick(r1, array[w1, w2, stranger]);
  assert j->>'status' = 'picking' and (j->>'picks_done')::boolean and j->'matches' = 'null'::jsonb, concat('picking ', j);
  assert (select count(*) from jsonb_array_elements(j->'members') e where (e->>'picked')::boolean) = 2, 'outsiders ignored';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_status(r1);
  assert (select count(*) from jsonb_array_elements(j->'members') e where (e->>'picked')::boolean) = 0, 'picks are private';
  perform public.group_pick(r1, array[m2]);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.group_pick(r1, '{}');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_pick(r1, array[m1]);
  assert j->>'status' = 'done' and jsonb_array_length(j->'matches') = 1 and j->'matches'->0->>'name' = 'Gil'
     and j->'matches'->0->>'conversation_id' is not null, concat('mutual → match ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_status(r1);
  assert jsonb_array_length(j->'matches') = 0, 'one-sided pick reveals nothing';
  reset role;
  select count(*) into n from public.matches where (user_a, user_b) in ((least(m1, w1), greatest(m1, w1)), (least(m1, w2), greatest(m1, w2)), (least(m2, w2), greatest(m2, w2)));
  assert n = 1, 'only the mutual pair matched';
  log := log || ' private-picks+mutual-match';

  -- interests rooms
  perform set_config('request.jwt.claims', json_build_object('sub', gw, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_join('interests', v_int);
  r2 := (j->>'id')::uuid;
  assert j->'interest'->>'id' = v_int::text and j->>'mode' = 'interests', concat('interest room ', j);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_lobby();
  assert exists (select 1 from jsonb_array_elements(j->'interest_rooms') e where (e->>'room_id')::uuid = r2), concat('lobby lists it ', j);
  j := public.group_join('interests', v_int);
  assert (j->>'id')::uuid = r2, 'same interest → same room (no gender filter)';
  perform public.group_leave(r2);
  reset role;
  log := log || ' interests';

  -- friends: matches only; invite notification; accept; host starts
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_create_friends('Friday crew', array[w1, stranger]);
  r3 := (j->>'id')::uuid;
  assert j->'invited' = to_jsonb(array[w1]) and jsonb_array_length(j->'invites') = 1, concat('matches only ', j);
  begin perform public.group_start(r3); assert false, 'needs 2';
  exception when assert_failure then raise; when others then assert sqlerrm = 'need_more_people', sqlerrm; end;
  reset role;
  select count(*) into n from public.notifications where user_id = w1 and actor_id = m1 and type = 'live_invite';
  assert n = 1, 'invite notification';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.group_respond_invite(r3, true); assert false, 'uninvited';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_lobby();
  assert jsonb_array_length(j->'invites') = 1 and j->'invites'->0->'host'->>'name' = 'Gil', concat('invite in lobby ', j);
  j := public.group_respond_invite(r3, true);
  assert jsonb_array_length(j->'members') = 2, 'accepted';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_start(r3);
  assert j->>'status' = 'live', 'host starts';
  reset role;
  -- everyone but one leaves → picking
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.group_leave(r3);
  assert j->>'status' = 'picking', concat('room drops to picks ', j);
  reset role;
  log := log || ' friends';

  raise exception 'GROUP_TESTS_PASSED:%', log;
end $$;
