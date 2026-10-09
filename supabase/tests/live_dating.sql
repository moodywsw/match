-- Rolled-back tests for LIVE in a dating app (20261009_live_dating.sql).
-- Expected result: ERROR "LIVE_TESTS_PASSED:…"
do $$
declare
  h uuid := gen_random_uuid();   -- host (eligible)
  v uuid := gen_random_uuid();   -- viewer (eligible)
  w uuid := gen_random_uuid();   -- watcher with an incomplete profile
  n1 uuid := gen_random_uuid();  -- brand-new account (complete)
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); d4 uuid := gen_random_uuid();
  x uuid := gen_random_uuid();   -- blocks d1
  ad uuid := gen_random_uuid();  -- admin, new account
  inc uuid := gen_random_uuid(); -- incognito SUPER MATCH user
  fillers uuid[];
  mid uuid; cid uuid; du uuid; s1 uuid; s2 uuid; s3 uuid; msg uuid; j jsonb; n int; t text; ok boolean; arr uuid[]; ts timestamptz;
  log text := '';
begin
  -- isolate from real / seeded rooms in the project
  update public.live_streams set ended_at = now() where ended_at is null;

  insert into auth.users (id, email, aud, role)
  select u, u::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[h, v, w, n1, d1, d2, d3, d4, x, ad, inc]) u;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable, intention, bio, created_at)
  select u, nm, '1995-03-01', true, true, 'serious', 'Hi, I like long walks', now() - interval '30 days' from (values
    (h, 'Helena'), (v, 'Vasco'), (w, 'Wanda'), (n1, 'Nuno'), (d1, 'Dina'), (d2, 'Diogo'), (d3, 'Daniela'), (d4, 'Dário'),
    (x, 'Xavier'), (ad, 'Admin'), (inc, 'Ines')) p(u, nm);
  update public.profiles set bio = null where id = w;                                        -- incomplete
  update public.profiles set created_at = now() - interval '6 hours' where id in (n1, ad);   -- too new (< 1 day)
  update public.profiles set is_admin = true where id = ad;
  insert into public.photos (user_id, url, position, is_primary)
  select u, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || u || '/1.jpg', 0, true
    from unnest(array[h, v, n1, d1, d2, d3, d4, x, ad, inc]) u;                               -- w has no photo
  insert into public.user_interests (user_id, interest_id)
  select u, i.id from unnest(array[h, v, w, n1, d1, d2, d3, d4, x, ad, inc]) u, (select id from public.interests order by id limit 3) i;
  insert into public.subscriptions (user_id, tier, store, status) values (inc, 'super_match', 'test_store', 'active');
  update public.profiles set incognito = true where id = inc;
  insert into public.blocks (blocker_id, blocked_id) values (x, d1);

  ---------------------------------------------------------------- 2. hosting rules
  perform set_config('request.jwt.claims', json_build_object('sub', n1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_live_eligibility();
  assert (j->>'can_host')::boolean = false and j->>'host_block' = 'account_too_new' and j->>'host_ready_at' is not null, 'eligibility: too new';
  assert (j->>'can_interact')::boolean, 'new but complete account can interact';
  begin
    perform public.start_live('Too soon', 'Talk');
    assert false, 'new accounts cannot host';
  exception when assert_failure then raise; when others then assert sqlerrm = 'account_too_new', concat('new host: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_live('Incomplete', 'Talk');
    assert false, 'incomplete profiles cannot host';
  exception when assert_failure then raise; when others then assert sqlerrm = 'profile_incomplete', concat('incomplete host: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', inc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_live('Hidden host', 'Talk');
    assert false, 'incognito cannot host';
  exception when assert_failure then raise; when others then assert sqlerrm = 'incognito_live', concat('incognito host: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  s3 := public.start_live('Admin QA room', 'Talk');                 -- admins exempt from account age
  perform public.end_live(s3);
  reset role;
  log := log || ' hosting';

  ---------------------------------------------------------------- 1. watching open, interaction gated
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  s1 := public.start_live('Sunday chat', 'Talk');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.join_live(s1);
  assert t = 'viewer', 'incomplete profile can watch';
  select can_interact into ok from public.get_live_state(s1);
  assert not ok, 'state says cannot interact';
  j := public.get_live_eligibility();
  assert j->'missing' ? 'photo' and j->'missing' ? 'bio' and not (j->'missing' ? 'interests'), concat('missing list ', j->>'missing');
  begin
    insert into public.live_messages (stream_id, body) values (s1, 'hey');
    assert false, 'incomplete profile cannot comment';
  exception when assert_failure then raise; when others then assert sqlerrm = 'profile_incomplete', concat('comment gate: ', sqlerrm); end;
  begin
    perform public.send_live_gift(s1, 'rose', 1);
    assert false, 'incomplete profile cannot gift';
  exception when assert_failure then raise; when others then assert sqlerrm = 'profile_incomplete', concat('gift gate: ', sqlerrm); end;
  perform public.send_live_reaction(s1, 1);                          -- hearts stay open
  reset role;
  -- TODO switch: verified photo requirement
  update public.app_settings set value = '1' where key = 'live_require_verified_photo';
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_live_eligibility();
  assert j->'missing' ? 'verified_photo' and (j->>'verified_required')::boolean, 'verified switch adds requirement';
  reset role;
  update public.app_settings set value = '0' where key = 'live_require_verified_photo';
  log := log || ' gating';

  ---------------------------------------------------------------- 3. match from live
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_live(s1);
  insert into public.live_messages (stream_id, body) values (s1, 'Love this topic!') returning id into msg;
  j := public.like_from_live(s1, h);
  assert (j->>'liked')::boolean and not (j->>'matched')::boolean, 'viewer likes host';
  begin
    perform public.like_from_live(s1, w);
    assert false, 'viewer cannot like other viewers';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', concat('viewer->viewer: ', sqlerrm); end;
  select (e->>'liked')::boolean into ok from public.get_live_state(s1) st, jsonb_array_elements(st.stage) e where (e->>'id')::uuid = h;
  assert ok, 'stage shows my like';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select commented, watching into ok, ok from public.get_live_people(s1) where user_id = v;
  assert found, 'host sees commenter';
  j := public.like_from_live(s1, v);
  assert (j->>'matched')::boolean and j->>'conversation_id' is not null, 'mutual like from live = match + conversation';
  begin
    perform public.like_from_live(s1, w);
    assert false, 'host cannot like silent viewers';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', concat('silent viewer: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.get_live_people(s1);
    assert false, 'viewers cannot list the room';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_host', concat('people list: ', sqlerrm); end;
  reset role;
  -- daily like limit applies to likes from live
  select array_agg(gen_random_uuid()) into fillers from generate_series(1, 25);
  insert into auth.users (id, email, aud, role) select u, u::text || '@tests.match', 'authenticated', 'authenticated' from unnest(fillers) u;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable) select u, 'Filler', '1995-01-01', true, true from unnest(fillers) u;
  insert into public.likes (liker_id, liked_id) select w, u from unnest(fillers) u;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.like_from_live(s1, h);
    assert false, 'daily like limit applies';
  exception when assert_failure then raise; when others then assert sqlerrm = 'daily_like_limit', concat('limit: ', sqlerrm); end;
  reset role;
  log := log || ' match-from-live';

  ---------------------------------------------------------------- 6. no private messages without a match
  select m.id, c.id into mid, cid from public.matches m join public.conversations c on c.match_id = m.id
   where m.user_a = least(h, v) and m.user_b = greatest(h, v);
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_live(s1);
  begin
    insert into public.conversations (match_id) values (mid);
    assert false, 'viewers cannot open conversations';
  exception when assert_failure then raise; when others then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, type, content) values (cid, d2, 'text', 'hi from the audience');
    assert false, 'viewers cannot message the host without a match';
  exception when assert_failure then raise; when others then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, type, content) values (cid, h, 'text', 'spoofed');
    assert false, 'cannot send as someone else';
  exception when assert_failure then raise; when others then null; end;
  select count(*) into n from public.messages where conversation_id = cid;
  assert n = 0, 'host conversations invisible to viewers';
  reset role;
  log := log || ' dm-needs-match';

  ---------------------------------------------------------------- 5. safety
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.live_moderate(s1, v, 'mute');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select my_status into t from public.get_live_state(s1);
  assert t = 'muted', 'muted status visible to the viewer';
  begin
    insert into public.live_messages (stream_id, body) values (s1, 'muted?');
    assert false, 'muted viewer cannot comment';
  exception when assert_failure then raise; when others then assert sqlerrm = 'muted_in_live', concat('mute: ', sqlerrm); end;
  begin
    perform public.live_moderate(s1, d2, 'remove');
    assert false, 'only the host moderates';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_host', concat('mod by viewer: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.live_moderate(s1, v, 'unmute');
  perform public.live_set_comments_muted(s1, true);
  insert into public.live_messages (stream_id, body) values (s1, 'Host can still talk');
  perform public.live_pin_message(s1, msg);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.live_messages (stream_id, body) values (s1, 'still muted?');
    assert false, 'comments muted for everyone';
  exception when assert_failure then raise; when others then assert sqlerrm = 'comments_muted', concat('room mute: ', sqlerrm); end;
  select comments_muted, (pinned->>'id')::uuid = msg into ok, ok from public.get_live_state(s1);
  assert ok, 'pinned line visible';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.live_set_comments_muted(s1, false);
  perform public.live_moderate(s1, v, 'remove');
  select count(*) into n from public.get_live_people(s1) where user_id = v;
  assert n = 0, 'removed person gone from host list';
  select pinned into j from public.get_live_state(s1);
  assert j is null, 'removed person''s pinned line cleared';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_live(s1);
    assert false, 'removed viewer cannot rejoin';
  exception when assert_failure then raise; when others then assert sqlerrm = 'removed_from_live', concat('rejoin: ', sqlerrm); end;
  select count(*) into n from public.get_live_rooms(null) where id = s1;
  assert n = 0, 'removed viewer no longer sees the room';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.live_messages where stream_id = s1 and user_id = v;
  assert n = 0, 'removed person''s lines hidden from others';
  reset role;
  log := log || ' moderation';

  ---------------------------------------------------------------- 4a. speed dating
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.end_live(s1);
  begin
    perform public.start_live('Speed + guest', 'Talk', v, 'speed_dating');
    assert false, 'no LIVE MATCH guest in themed rooms';
  exception when assert_failure then raise; when others then assert sqlerrm = 'guest_not_allowed', concat('guest: ', sqlerrm); end;
  s2 := public.start_live('Speed dating Lisbon', 'Music', null, 'speed_dating');
  select category, room_type into t, t from public.live_streams where id = s2;
  assert t = 'speed_dating', 'room type stored';
  assert (select category from public.live_streams where id = s2) = 'Dating', 'themed rooms are Dating';
  begin
    perform public.live_next_round(s2);
    assert false, 'need daters';
  exception when assert_failure then raise; when others then assert sqlerrm = 'need_more_daters', concat('min: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.live_take_seat(s2);
    assert false, 'incomplete profile cannot take a seat';
  exception when assert_failure then raise; when others then assert sqlerrm = 'profile_incomplete', concat('seat gate: ', sqlerrm); end;
  reset role;
  foreach du in array array[d1, d2, d3] loop
    perform set_config('request.jwt.claims', json_build_object('sub', du, 'role', 'authenticated')::text, true);
    set local role authenticated;
    n := public.live_take_seat(s2);
    t := public.join_live(s2);
    assert t = 'dater', concat('seated role ', t);
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', d4, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.live_take_seat(s2);
    assert false, 'stage holds host + 3';
  exception when assert_failure then raise; when others then assert sqlerrm = 'stage_full', concat('full: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select can_publish into ok from public.get_live_token_grant(s2);
  assert ok, 'daters can publish video';
  begin
    perform public.live_next_round(s2);
    assert false, 'only host runs rounds';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_host', concat('round by dater: ', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.live_next_round(s2);
  assert n = 1, 'round 1';
  select round_pair, round_ends_at, round_started_at into arr, ts, ts from public.get_live_state(s2);
  assert arr = array[h, d3], concat('round 1 pairs host with seat 3: ', arr::text);
  select round_ends_at - round_started_at = interval '180 seconds' into ok from public.get_live_state(s2);
  assert ok, '3-minute rounds';
  n := public.live_next_round(s2);
  select round_pair into arr from public.get_live_state(s2);
  assert arr = array[d1, d2], concat('round 2 rotates: ', arr::text);
  reset role;
  select count(*) into n from (select distinct p from generate_series(1, 6) g, lateral (select a || '-' || b p from private.speed_pair_order(4) where ord = g) z) q;
  assert n = 6, 'four people meet everyone in six rounds';
  set local role authenticated;
  select jsonb_array_length(stage) into n from public.get_live_state(s2);
  assert n = 4, 'stage lists host + 3 daters';
  reset role;
  -- blocks apply on stage: x blocked d1, so x cannot see this room
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_live_rooms(null) where id = s2;
  assert n = 0, 'blocked dater hides the room';
  reset role;
  -- daters can like each other; host unseats
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.like_from_live(s2, d1);
  assert (j->>'liked')::boolean, 'dater likes dater';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.live_moderate(s2, d3, 'unseat');
  select jsonb_array_length(stage) into n from public.get_live_state(s2);
  assert n = 3, 'unseated';
  perform public.end_live(s2);
  reset role;
  log := log || ' speed-dating';

  ---------------------------------------------------------------- 4b. question of the night
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  s3 := public.start_live('Question of the night', 'Talk', null, 'question_night');
  select question, room_type into t, t from public.get_live_state(s3);
  assert (select question from public.live_streams where id = s3) = 'What does your perfect Friday night look like?', 'defaults to the Friday prompt';
  select count(*) into n from public.get_live_rooms(null) where id = s3 and room_type = 'question_night';
  assert n = 1, 'room list carries the type';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_live(s3);
  insert into public.live_messages (stream_id, body) values (s3, 'Sunset at a miradouro') returning id into msg;
  begin
    perform public.live_pin_message(s3, msg);
    assert false, 'only host pins';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_host', concat('pin: ', sqlerrm); end;
  reset role;
  log := log || ' question-night';

  -- no location anywhere in live payloads
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select stage into j from public.get_live_state(s3);
  assert not (j::text ~* '(lat|lng|city|distance)'), 'stage carries no location';
  reset role;

  raise exception 'LIVE_TESTS_PASSED:%', log;
end $$;
