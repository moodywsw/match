-- Core-flow smoke tests. Everything runs in one DO block that ALWAYS ends by raising,
-- so all writes are rolled back (safe to run against production).
--
-- Run: paste into the Supabase SQL editor (or `psql -f`). Expected result is an ERROR whose
-- message starts with `ALL_TESTS_PASSED`. Any other error = a failing assertion (its message
-- names the check).
--
-- Identity switching: request.jwt.claims + `set local role authenticated` (what PostgREST does).
do $$
declare
  a uuid := gen_random_uuid();  -- Ana
  b uuid := gen_random_uuid();  -- Bruno
  c uuid := gen_random_uuid();  -- Carla
  d uuid := gen_random_uuid();  -- Duarte
  e uuid := gen_random_uuid();  -- Eva (reporter)
  n int; t text; ok boolean; dt date;
  v_match uuid; v_conv uuid; v_story uuid; v_post uuid; v_event uuid; v_stream uuid; v_report uuid;
  log text := '';
begin
  insert into auth.users (id, email, aud, role)
  select x, x::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[a, b, c, d, e]) x;

  ---------------------------------------------------------------- 1. onboarding / profile
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.profiles (id, name, birth_date) values (a, 'Kid', current_date - interval '16 years');
    assert false, 'under-18 profile must be rejected';
  exception when assert_failure then raise; when others then null; end;
  insert into public.profiles (id, name, birth_date, gender, city, intention, onboarding_complete, is_discoverable)
  values (a, 'Ana', '1996-02-10', 'woman', 'Lisbon', 'serious', true, true);
  update public.profiles set bio = 'hello', updated_at = now() where id = a;
  select name, birth_date into t, dt from public.get_my_profile();
  assert t = 'Ana' and dt = '1996-02-10', 'get_my_profile returns own full row';
  begin
    update public.profiles set verified = true where id = a;
    assert false, 'users must not self-verify';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  insert into public.profiles (id, name, birth_date, gender, city, intention, onboarding_complete, is_discoverable)
  select x, nm, '1994-07-01', 'man', 'Lisbon', 'serious', true, true
  from (values (b, 'Bruno'), (c, 'Carla'), (d, 'Duarte'), (e, 'Eva')) v(x, nm);
  log := log || ' profile';

  ---------------------------------------------------------------- 2. discover → like → match → chat
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_discover_deck(100, true) where id in (b, c, d);
  assert n = 3, 'deck shows the other members';
  select birth_date into dt from public.get_discover_deck(100, true) where id = b;
  assert dt <> '1994-07-01' and extract(year from age(current_date, dt)) = extract(year from age(current_date, date '1994-07-01')),
    'deck returns an age anchor, not the real DOB';
  begin
    select birth_date into dt from public.profiles where id = b;
    assert false, 'other members'' birth_date must not be selectable';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  insert into public.likes (liker_id, liked_id) values (a, b);
  select count(*) into n from public.get_discover_deck(100, true) where id = b;
  assert n = 0, 'liked person leaves the deck';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.likes (liker_id, liked_id) values (b, a);
  select m.id into v_match from public.matches m where (m.user_a, m.user_b) = (least(a, b), greatest(a, b));
  assert v_match is not null, 'mutual like creates a match';
  v_conv := public.ensure_conversation(v_match);
  assert v_conv is not null, 'conversation exists for the match';
  insert into public.messages (conversation_id, sender_id, content) values (v_conv, b, 'Olá Ana!');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.messages where conversation_id = v_conv;
  assert n = 1, 'match partner reads the message';
  select count(*) into n from public.notifications where user_id = a and type in ('match', 'message');
  assert n >= 2, 'match + message notifications written';
  n := public.mark_conversation_read(v_conv);
  assert n >= 1, 'mark_conversation_read marks incoming messages';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.messages where conversation_id = v_conv;
  assert n = 0, 'outsiders cannot read the chat';
  begin
    perform public.ensure_conversation(v_match);
    assert false, 'outsiders cannot open the conversation';
  exception when assert_failure then raise; when others then null; end;
  reset role;
  log := log || ' match+chat';

  ---------------------------------------------------------------- 3. blocks
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.blocks (blocker_id, blocked_id) values (c, a);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_discover_deck(100, true) where id = c;
  assert n = 0, 'blocked person hidden from deck (either direction)';
  select count(*) into n from public.profiles where id = c;
  assert n = 0, 'blocked person''s profile row hidden';
  reset role;
  log := log || ' blocks';

  ---------------------------------------------------------------- 4. stories
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.stories (user_id, type, content) values (b, 'poll', '{"question":"Coffee or tea?","options":["Coffee","Tea"]}')
  returning id into v_story;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.stories where id = v_story;
  assert n = 1, 'match sees the story';
  insert into public.story_views (story_id, viewer_id) values (v_story, a);
  insert into public.story_responses (story_id, responder_id, kind, option_index) values (v_story, a, 'vote', 0);
  select sum(votes) into n from public.get_story_poll_counts(v_story);
  assert n = 1, 'poll vote counted';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.stories where id = v_story;
  assert n = 1, 'discoverable member''s story visible to non-blocked members';
  reset role;
  log := log || ' stories';

  ---------------------------------------------------------------- 5. feed + moderation
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.posts (user_id, type, content) values (d, 'text', 'Best pastel de nata in Lisbon?') returning id into v_post;
  begin
    insert into public.posts (user_id, type, content) values (d, 'text', repeat('x', 2001));
    assert false, 'over-long post rejected';
  exception when assert_failure then raise; when check_violation then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.comments (post_id, user_id, content) values (v_post, a, 'Manteigaria!');
  insert into public.post_likes (post_id, user_id) values (v_post, a);
  insert into public.reports (reporter_id, post_id, category) values (a, v_post, 'spam');
  select reported_id into t from public.reports where post_id = v_post and reporter_id = a;
  assert t = d::text, 'report on a post derives the reported user';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reports (reporter_id, post_id, category) values (b, v_post, 'spam');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reports (reporter_id, post_id, category) values (e, v_post, 'inappropriate');
  select count(*) into n from public.posts where id = v_post;
  assert n = 0, 'post auto-hidden after 3 distinct reporters';
  begin
    insert into public.reports (reporter_id, reported_id, category, status) values (e, d, 'spam', 'resolved');
    assert false, 'reporters cannot set report status';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.posts where id = v_post;
  assert n = 1, 'author still sees their hidden post';
  begin
    update public.posts set hidden_at = null where id = v_post;
    assert false, 'author cannot unhide a moderated post';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  log := log || ' feed+moderation';

  ---------------------------------------------------------------- 6. events
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.events (title, category, city, starts_at, capacity)
  values ('Sunset mixer', 'Nightlife', 'Lisbon', now() + interval '3 days', 2) returning id into v_event;
  select count(*) into n from public.event_participants where event_id = v_event and user_id = a and status = 'going';
  assert n = 1, 'creator is auto-RSVPed as going';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.event_participants (event_id, user_id, status) values (v_event, b, 'going');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.event_participants (event_id, user_id, status) values (v_event, d, 'going');
    assert false, 'capacity enforced';
  exception when assert_failure then raise; when others then
    assert sqlerrm = 'event_full', 'capacity error code is event_full';
  end;
  insert into public.event_participants (event_id, user_id, status) values (v_event, d, 'interested');
  select going_count into n from public.get_events('upcoming', null, null, v_event, 5);
  assert n = 2, 'get_events going_count';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.events where id = v_event;
  assert n = 0, 'event of a blocked creator is hidden';
  reset role;
  log := log || ' events';

  ---------------------------------------------------------------- 7. live
  -- live needs a complete profile (+ 7-day-old account to host): make these users eligible
  update public.profiles set bio = coalesce(bio, 'Hello there'), intention = coalesce(intention, 'serious'),
         created_at = now() - interval '30 days' where id = any(array[a, d]);
  insert into public.photos (user_id, url, position, is_primary)
  select x, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || x || '/1.jpg', 0, true from unnest(array[a, d]) x;
  insert into public.user_interests (user_id, interest_id)
  select x, i.id from unnest(array[a, d]) x, (select id from public.interests order by id limit 3) i
  on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_stream := public.start_live('Lisbon rooftop chat', 'Talk', b);
  select can_publish into ok from public.get_live_token_grant(v_stream);
  assert ok, 'host can publish';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.join_live(v_stream);
  assert t = 'viewer', 'viewer joins';
  select can_publish into ok from public.get_live_token_grant(v_stream);
  assert not ok, 'viewer cannot publish';
  insert into public.live_messages (stream_id, body) values (v_stream, 'oi!');
  perform public.send_live_reaction(v_stream, 3);
  perform public.vote_live_match(v_stream, true);
  select viewers into n from public.get_live_state(v_stream);
  assert n = 1, 'viewer counted';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_live_rooms(null) where id = v_stream;
  assert n = 0, 'blocked user does not see the live';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.end_live(v_stream);
  select status into t from public.get_live_state(v_stream);
  assert t = 'ended', 'live ended';
  reset role;
  log := log || ' live';

  ---------------------------------------------------------------- 8. rate limits + anon
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    for n in 1..11 loop
      insert into public.events (title, starts_at) values ('Spam event ' || n, now() + interval '1 day');
    end loop;
    assert false, 'event creation rate limit (10/day)';
  exception when assert_failure then raise; when others then
    assert sqlerrm = 'rate_limited', 'rate limit error code';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into n from public.interests;
  begin
    perform 1 from public.profiles limit 1;
    assert false, 'anon must not read profiles';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  log := log || ' ratelimit+anon';

  -- push token handoff: a device token follows the account signed in now
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.push_tokens (user_id, token, platform) values (a, 'ExponentPushToken[shared]', 'ios');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.push_tokens (user_id, token, platform) values (b, 'ExponentPushToken[shared]', 'ios');
  reset role;
  select count(*) into n from public.push_tokens where token = 'ExponentPushToken[shared]' and user_id = a;
  assert n = 0, 'push token unlinked from the previous account';
  log := log || ' push-handoff';

  raise exception 'ALL_TESTS_PASSED:%', log;
end $$;
