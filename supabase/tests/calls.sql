-- Rolled-back tests for 1:1 calls. Expected result: ERROR "CALL_TESTS_PASSED:…"
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  v_match uuid; v_conv uuid; v_call uuid; v_call2 uuid; t text; n int; ok boolean;
  log text := '';
begin
  insert into auth.users (id, email, aud, role)
  select x, x::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[a, b, c]) x;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable)
  select x, nm, '1994-07-01', true, true from (values (a, 'Ana'), (b, 'Bruno'), (c, 'Carla')) v(x, nm);
  insert into public.matches (user_a, user_b) values (least(a, b), greatest(a, b)) returning id into v_match;
  select id into v_conv from public.conversations where match_id = v_match;
  assert v_conv is not null, 'conversation created for match';

  -- outsider can't call into the conversation
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_call(v_conv, 'video');
    assert false, 'outsider cannot start a call';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', concat('outsider err ', sqlerrm); end;
  -- clients can't write calls or call messages directly
  begin
    insert into public.calls (match_id, conversation_id, caller_id, callee_id, kind) values (v_match, v_conv, c, a, 'video');
    assert false, 'no direct call inserts';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;

  -- a calls b → ringing, b sees it, c doesn't
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_call := public.start_call(v_conv, 'video');
  select can_publish into ok from public.get_call_token_grant(v_call);
  assert ok, 'caller gets a token while ringing';
  begin
    perform public.start_call(v_conv, 'audio');
    assert false, 'second concurrent call is busy';
  exception when assert_failure then raise; when others then assert sqlerrm = 'busy', concat('busy err ', sqlerrm); end;
  begin
    insert into public.messages (conversation_id, sender_id, type, content) values (v_conv, a, 'call', 'ended:video');
    assert false, 'clients cannot forge call messages';
  exception when assert_failure then raise; when others then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.calls where id = v_call;
  assert n = 0, 'outsider cannot see the call';
  begin
    perform * from public.get_call_token_grant(v_call);
    assert false, 'outsider gets no token';
  exception when assert_failure then raise; when others then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.calls where id = v_call and status = 'ringing';
  assert n = 1, 'callee sees the ringing call';
  begin
    perform * from public.get_call_token_grant(v_call);
    assert false, 'callee gets no token before answering';
  exception when assert_failure then raise; when others then assert sqlerrm = 'call_ended', concat('callee token err ', sqlerrm); end;
  t := public.answer_call(v_call, true);
  assert t = 'accepted', 'callee accepts';
  select can_publish into ok from public.get_call_token_grant(v_call);
  assert ok, 'callee token after accepting';
  t := public.call_heartbeat(v_call);
  assert t = 'accepted', 'heartbeat returns status';
  t := public.end_call(v_call);
  assert t = 'ended', 'callee hangs up';
  select count(*) into n from public.messages where call_id = v_call and type = 'call' and content = 'ended:video';
  assert n = 1, 'chat summary for the ended call';
  reset role;
  log := log || ' accept+end';

  -- a calls again, hangs up while ringing → missed + notification for b
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_call2 := public.start_call(v_conv, 'audio');
  t := public.end_call(v_call2);
  assert t = 'missed', 'caller cancel = missed';
  reset role;
  select count(*) into n from public.notifications where user_id = b and type = 'missed_call' and payload->>'call_id' = v_call2::text;
  assert n = 1, 'missed-call notification';
  select count(*) into n from public.notifications where user_id = b and type = 'message' and payload->>'message_id' in (select id::text from public.messages where call_id = v_call2);
  assert n = 0, 'call summary does not create a message notification';
  log := log || ' missed';

  -- decline
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_call := public.start_call(v_conv, 'video');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.answer_call(v_call, false);
  assert t = 'declined', 'callee declines';
  reset role;
  log := log || ' decline';

  -- stale ringing expires to missed
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_call := public.start_call(v_conv, 'video');
  reset role;
  update public.calls set created_at = now() - interval '2 minutes' where id = v_call;
  perform private.expire_calls();
  select status into t from public.calls where id = v_call;
  assert t = 'missed', 'unanswered call expires as missed';
  log := log || ' expiry';

  -- blocked users can't call
  insert into public.blocks (blocker_id, blocked_id) values (b, a);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_call(v_conv, 'video');
    assert false, 'blocked call refused';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_allowed', concat('blocked err ', sqlerrm); end;
  reset role;
  delete from public.blocks where blocker_id = b and blocked_id = a;
  log := log || ' blocks';

  -- rate limit: 8 starts per 10 minutes
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    for n in 1..10 loop
      v_call := public.start_call(v_conv, 'audio');
      perform public.end_call(v_call);
    end loop;
    assert false, 'call rate limit';
  exception when assert_failure then raise; when others then assert sqlerrm = 'rate_limited', concat('rl err ', sqlerrm); end;
  reset role;
  log := log || ' ratelimit';

  raise exception 'CALL_TESTS_PASSED:%', log;
end $$;
