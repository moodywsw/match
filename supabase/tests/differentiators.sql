-- Rolled-back tests for daily picks, chats that don't die, post-date feedback.
-- Expected result: ERROR "DIFF_TESTS_PASSED:…"
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); e uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  h uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
  fillers uuid[];
  x uuid; j jsonb; j2 jsonb; ids uuid[]; n int; ts timestamptz; ts2 timestamptz; txt text; arr text[]; ok boolean;
  m_ab uuid; m_ac uuid; m_ad uuid; conv_ab uuid; conv_ac uuid; conv_ad uuid; m_t uuid;
  log text := '';
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[a, b, c, d, e, f, h, t, r1, r2, r3]) u;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable, intention, city, friday_answer)
  select u, nm, '1994-07-01', true, true, it, 'Lisbon', fr from (values
    (a, 'Ana', 'serious', null), (b, 'Bruno', 'serious', 'Sunset at Miradouro'), (c, 'Carla', 'casual', null),
    (d, 'Duarte', null, null), (e, 'Eva', null, null), (f, 'Filipe', null, null), (h, 'Helena', null, null),
    (t, 'Tiago', null, null), (r1, 'Rita', null, null), (r2, 'Rui', null, null), (r3, 'Rosa', null, null)) v(u, nm, it, fr);
  insert into public.user_interests (user_id, interest_id)
  select u, i.id from unnest(array[a, b]) u, public.interests i where i.label in ('Jazz', 'Sushi');
  insert into public.blocks (blocker_id, blocked_id) values (e, a);           -- e blocked a
  update public.profiles set hidden_at = now() where id = f;                  -- f hidden by moderation
  insert into public.likes (liker_id, liked_id) values (a, h);                -- a already liked h

  ---------------------------------------------------------------- daily picks
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_daily_picks('Europe/Lisbon');
  select array_agg((p->>'id')::uuid) into ids from jsonb_array_elements(j->'picks') p;
  assert (j->>'quota')::int = 7, concat('free quota 7, got ', j->>'quota');
  assert b = any(ids) and c = any(ids) and d = any(ids), 'eligible people picked';
  assert not (e = any(ids)) and not (f = any(ids)) and not (h = any(ids)) and not (a = any(ids)), 'blocked/hidden/liked/self excluded';
  assert cardinality(ids) <= 7, 'quota respected';
  select p->>'reason' into txt from jsonb_array_elements(j->'picks') p where (p->>'id')::uuid = b;
  assert txt like 'You both love %', concat('shared-interest reason, got ', txt);
  select (p->>'rank')::int into n from jsonb_array_elements(j->'picks') p where (p->>'id')::uuid = b;
  assert n = 1, 'best compatibility ranked first';
  assert (j->>'refreshes_at')::timestamptz > now() and (j->>'refreshes_at')::timestamptz <= now() + interval '25 hours', 'refresh countdown';
  j2 := public.get_daily_picks('Pacific/Kiritimati');   -- tz hop is ignored (weekly cooldown)
  assert j2->>'pick_date' = j->>'pick_date' and j2->'picks' = j->'picks', 'picks persist for the day';
  j2 := public.get_daily_picks('Not/AZone; drop table x');
  assert j2->>'pick_date' = j->>'pick_date', 'invalid tz ignored';
  begin
    insert into public.daily_picks (user_id, pick_date, target_id, rank, score, reason) values (a, current_date, c, 1, 99, 'x');
    assert false, 'no direct pick writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.daily_picks where user_id = a;
  assert n = 0, 'others cannot read my picks';
  reset role;

  -- acted sync + likes on picks don't use the free daily allowance
  select array_agg(gen_random_uuid()) into fillers from generate_series(1, 25);
  insert into auth.users (id, email, aud, role) select u, u::text || '@tests.match', 'authenticated', 'authenticated' from unnest(fillers) u;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable) select u, 'Filler', '1995-01-01', true, true from unnest(fillers) u;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.likes (liker_id, liked_id) values (a, b);
  perform public.record_pass(c);
  select acted into txt from public.daily_picks where user_id = a and target_id = b;
  assert txt = 'like', 'like marks pick acted';
  select acted into txt from public.daily_picks where user_id = a and target_id = c;
  assert txt = 'pass', 'pass marks pick acted';
  foreach x in array fillers[1:24] loop insert into public.likes (liker_id, liked_id) values (a, x); end loop;
  begin
    insert into public.likes (liker_id, liked_id) values (a, fillers[25]);
    assert false, 'free daily limit still applies to Explore';
  exception when assert_failure then raise; when others then assert sqlerrm = 'daily_like_limit', concat('limit err ', sqlerrm); end;
  insert into public.likes (liker_id, liked_id) values (a, d);   -- a pick: allowed past the limit
  reset role;
  delete from public.likes where liker_id = a;  delete from public.passes where passer_id = a;
  log := log || ' picks';

  ---------------------------------------------------------------- lifecycle
  insert into public.matches (user_a, user_b) values (least(a, b), greatest(a, b)) returning id into m_ab;
  insert into public.matches (user_a, user_b) values (least(a, c), greatest(a, c)) returning id into m_ac;
  insert into public.matches (user_a, user_b) values (least(a, d), greatest(a, d)) returning id into m_ad;
  select id into conv_ab from public.conversations where match_id = m_ab;
  select id into conv_ac from public.conversations where match_id = m_ac;
  select id into conv_ad from public.conversations where match_id = m_ad;
  select count(*) into n from public.match_lifecycle where match_id in (m_ab, m_ac, m_ad) and state = 'active';
  assert n = 3, 'lifecycle row per match';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  arr := public.get_conversation_starters(conv_ab);
  assert cardinality(arr) = 3, concat('3 starters, got ', cardinality(arr));
  assert exists (select 1 from unnest(arr) s where s like '%jazz%' or s like '%sushi%'), concat('interest starter ', arr::text);
  assert exists (select 1 from unnest(arr) s where s like '%Sunset at Miradouro%'), 'friday starter';
  begin
    update public.match_lifecycle set state = 'expired' where match_id = m_ab;
    get diagnostics n = row_count;
    assert n = 0, 'no client writes to lifecycle';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.match_lifecycle where match_id = m_ab;
  assert n = 0, 'outsider cannot see lifecycle';
  begin
    perform public.get_conversation_starters(conv_ab);
    assert false, 'outsider gets no starters';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  reset role;

  -- 24h, no messages → nudge both (once); blocked pair gets no notification
  insert into public.blocks (blocker_id, blocked_id) values (d, a);
  update public.match_lifecycle set matched_at = now() - interval '25 hours' where match_id in (m_ab, m_ad);
  perform private.match_lifecycle_tick();
  select count(*) into n from public.notifications where type = 'chat_nudge' and payload->>'match_id' = m_ab::text and user_id in (a, b);
  assert n = 2, concat('nudge both, got ', n);
  select count(*) into n from public.notifications where type = 'chat_nudge' and payload->>'match_id' = m_ad::text;
  assert n = 0, 'blocked pair not nudged';
  perform private.match_lifecycle_tick();
  select count(*) into n from public.notifications where type = 'chat_nudge' and payload->>'match_id' = m_ab::text;
  assert n = 2, 'nudge only once';
  log := log || ' nudge';

  -- 72h silence → expiring (+48h), notifications
  update public.match_lifecycle set matched_at = now() - interval '73 hours' where match_id = m_ab;
  perform private.match_lifecycle_tick();
  select state, expires_at into txt, ts from public.match_lifecycle where match_id = m_ab;
  assert txt = 'expiring' and ts between now() + interval '47 hours' and now() + interval '49 hours', concat('expiring ', txt);
  select count(*) into n from public.notifications where type = 'match_expiring' and payload->>'match_id' = m_ab::text;
  assert n = 2, 'both told it is expiring';

  -- Extend: each side once
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ts2 := public.extend_match(m_ab);
  assert ts2 between ts + interval '47 hours' and ts + interval '49 hours', 'extend adds 48h';
  begin
    perform public.extend_match(m_ab);
    assert false, 'extend once per person';
  exception when assert_failure then raise; when others then assert sqlerrm = 'already_extended', sqlerrm; end;
  begin
    perform public.extend_match(m_ac);
    assert false, 'only expiring matches can be extended';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_expiring', sqlerrm; end;
  reset role;
  select count(*) into n from public.notifications where type = 'match_extended' and user_id = b and actor_id = a;
  assert n = 1, 'other side told about the extension';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.extend_match(m_ab);
  -- a message revives it
  insert into public.messages (conversation_id, sender_id, type, content) values (conv_ab, b, 'text', 'Hey!');
  reset role;
  select state into txt from public.match_lifecycle where match_id = m_ab;
  assert txt = 'active', 'message revives an expiring match';
  log := log || ' expiring+extend';

  -- timer runs out → expired; archived (read-only), both notified, row kept
  update public.match_lifecycle set state = 'expiring', expires_at = now() - interval '1 minute' where match_id = m_ab;
  perform private.match_lifecycle_tick();
  select state into txt from public.match_lifecycle where match_id = m_ab;
  assert txt = 'expired', 'expired';
  select count(*) into n from public.notifications where type = 'match_expired' and payload->>'match_id' = m_ab::text;
  assert n = 2, 'both told it expired';
  select count(*) into n from public.messages where conversation_id = conv_ab;
  assert n = 1, 'history kept';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.messages (conversation_id, sender_id, type, content) values (conv_ab, a, 'text', 'Too late?');
    assert false, 'expired chat is read-only';
  exception when assert_failure then raise; when others then assert sqlerrm = 'match_expired', sqlerrm; end;
  begin
    perform public.start_call(conv_ab, 'video');
    assert false, 'no calls on expired matches';
  exception when assert_failure then raise; when others then assert sqlerrm = 'match_expired', sqlerrm; end;
  reset role;
  log := log || ' expired';

  -- video suggestion after 10 messages each
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for n in 1..10 loop insert into public.messages (conversation_id, sender_id, type, content) values (conv_ac, a, 'text', 'a' || n); end loop;
  reset role;
  select video_suggested_at is null into ok from public.match_lifecycle where match_id = m_ac;
  assert ok, 'not yet — only one side wrote';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for n in 1..10 loop insert into public.messages (conversation_id, sender_id, type, content) values (conv_ac, c, 'text', 'c' || n); end loop;
  reset role;
  select video_suggested_at is not null into ok from public.match_lifecycle where match_id = m_ac;
  assert ok, 'video call suggested';
  log := log || ' video';

  ---------------------------------------------------------------- dates
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.mark_we_met(m_ac);
    assert false, 'outsider cannot mark';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_date_feedback(m_ac, 'yes', true, 'yes', null);
    assert false, 'feedback needs We met first';
  exception when assert_failure then raise; when others then assert sqlerrm = 'mark_met_first', sqlerrm; end;
  j := public.mark_we_met(m_ac);
  assert (j->>'them')::boolean = false and (j->>'notified')::boolean, 'a marked first';
  reset role;
  select count(*) into n from public.notifications where type = 'we_met' and user_id = c and actor_id = a;
  assert n = 1, 'c asked to confirm';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.mark_we_met(m_ac);
  assert (j->>'them')::boolean, 'both confirmed';
  reset role;
  select count(*) into n from public.notifications where type = 'we_met' and user_id = a;
  assert n = 0, 'no confirm request once both said so';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_date_feedback(m_ac, 'maybe', true, 'yes', null);
    assert false, 'invalid values rejected';
  exception when assert_failure then raise; when others then assert sqlerrm = 'invalid_feedback', sqlerrm; end;
  x := public.submit_date_feedback(m_ac, 'no', false, 'no', 'Felt pressured to leave with them');
  begin
    perform public.submit_date_feedback(m_ac, 'yes', true, 'yes', null);
    assert false, 'one feedback per date';
  exception when assert_failure then raise; when others then assert sqlerrm = 'already_submitted', sqlerrm; end;
  select count(*) into n from public.date_feedback where id = x;
  assert n = 1, 'rater sees own feedback';
  select count(*) into n from public.reports where reporter_id = a and reported_id = c and category = 'date_unsafe' and status = 'open';
  assert n = 1, 'unsafe feedback auto-queued for moderation';
  begin
    insert into public.date_feedback (match_id, rater_id, ratee_id, looked_like_photos, felt_safe, meet_again)
    values (m_ac, a, c, 'yes', true, 'yes');
    assert false, 'no direct feedback writes';
  exception when assert_failure then raise; when others then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.date_feedback where ratee_id = c;
  assert n = 0, 'ratee never sees feedback about them';
  select count(*) into n from public.reports where reported_id = c;
  assert n = 0, 'ratee cannot see the report';
  reset role;
  log := log || ' we-met+feedback';

  -- prompt 24h after both confirmed → only the side that hasn't answered (c)
  update public.date_confirmations set created_at = now() - interval '25 hours' where match_id = m_ac;
  perform private.date_feedback_tick();
  select count(*) into n from public.notifications where type = 'date_feedback' and payload->>'match_id' = m_ac::text and user_id = c;
  assert n = 1, 'c prompted';
  select count(*) into n from public.notifications where type = 'date_feedback' and user_id = a;
  assert n = 0, 'a already answered';
  -- a dated match never goes expiring
  update public.match_lifecycle set last_message_at = now() - interval '100 hours' where match_id = m_ac;
  perform private.match_lifecycle_tick();
  select state into txt from public.match_lifecycle where match_id = m_ac;
  assert txt = 'active', 'we-met matches do not expire';
  log := log || ' prompt';

  -- trust badge: 3 positive, mutually-confirmed dates → badge (boolean only)
  foreach x in array array[r1, r2, r3] loop
    insert into public.matches (user_a, user_b) values (least(t, x), greatest(t, x)) returning id into m_t;
    insert into public.date_confirmations (match_id, user_id) values (m_t, t), (m_t, x);
    insert into public.date_feedback (match_id, rater_id, ratee_id, looked_like_photos, felt_safe, meet_again)
    values (m_t, x, t, case when x = r3 then 'mostly' else 'yes' end, true, 'yes');
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select real_photos into ok from public.get_trust_badges(array[t]);
  assert ok, 'badge after 3 positive dates';
  reset role;
  delete from public.date_feedback where rater_id = r3;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select real_photos into ok from public.get_trust_badges(array[t]);
  assert not ok, 'no badge with only 2';
  select count(*) into n from public.get_trust_badges(array[f]);
  assert n = 0, 'no badge info for hidden people';
  reset role;
  log := log || ' trust';

  raise exception 'DIFF_TESTS_PASSED:%', log;
end $$;
