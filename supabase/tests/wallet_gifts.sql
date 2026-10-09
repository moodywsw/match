do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  v_stream uuid; v_event uuid; n int; bal bigint; j jsonb; t text; log text := '';
begin
  insert into auth.users (id, email, aud, role)
  select x, x::text || '@tests.match', 'authenticated', 'authenticated' from unnest(array[a, b, c]) x;
  insert into public.profiles (id, name, birth_date, onboarding_complete, is_discoverable)
  select x, nm, '1994-07-01', true, true from (values (a, 'Ana'), (b, 'Bruno'), (c, 'Carla')) v(x, nm);

  -- Clients cannot write wallets / ledger / gift events / packs
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.wallets (user_id, coins) values (a, 999);
    assert false, 'no client wallet writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    insert into public.wallet_transactions (user_id, currency, amount, balance_after, kind) values (a, 'coins', 1, 1, 'purchase');
    assert false, 'no client ledger writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    insert into public.gift_events (gift_id, sender_id, receiver_id, quantity, coins, diamonds) values ('rose', a, b, 1, 1, 1);
    assert false, 'no client gift writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    insert into public.coin_packs (product_id, coins) values ('hack', 999999);
    assert false, 'no client pack writes';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  begin
    perform public.credit_coin_purchase(a, 'coins_100', 'tx1', 'SANDBOX');
    assert false, 'clients cannot credit purchases';
  exception when assert_failure then raise; when insufficient_privilege then null; end;
  reset role;
  log := log || ' lockdown';

  -- Admin grants coins (for testing / support); service_role credits a pack purchase
  update public.profiles set is_admin = true where id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  bal := public.admin_grant_coins(a, 50, 'test grant');
  assert bal = 50, 'admin grant';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
  j := public.credit_coin_purchase(a, 'coins_100', 'store-tx-1', 'SANDBOX');
  assert (j->>'ok')::boolean and (j->>'coins')::int = 100, concat('purchase ', j);
  j := public.credit_coin_purchase(a, 'coins_100', 'store-tx-1', 'SANDBOX');
  assert (j->>'duplicate')::boolean, 'purchase is idempotent';
  j := public.credit_coin_purchase(a, 'coins_bogus', 'store-tx-x', 'SANDBOX');
  assert j->>'reason' = 'unknown_product', 'unknown product rejected';
  reset role;
  select coins into bal from public.wallets where user_id = a;
  assert bal = 150, concat('balance after purchase=', bal);
  log := log || ' credit';

  -- Live gift: a gifts host b
  -- live needs a complete profile (+ account older than the host minimum): make these users eligible
  update public.profiles set bio = coalesce(bio, 'Hello there'), intention = coalesce(intention, 'serious'),
         created_at = now() - interval '30 days' where id = any(array[a, b]);
  insert into public.photos (user_id, url, position, is_primary)
  select x, 'https://t.supabase.co/storage/v1/object/public/profile-photos/' || x || '/1.jpg', 0, true from unnest(array[a, b]) x;
  insert into public.user_interests (user_id, interest_id)
  select x, i.id from unnest(array[a, b]) x, (select id from public.interests order by id limit 3) i
  on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_stream := public.start_live('Gift night', 'Talk', null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select gift_event_id, coins_balance into v_event, bal from public.send_live_gift(v_stream, 'rose', 3);
  assert bal = 147, concat('after rose x3 balance=', bal);
  select diamonds into n from public.gift_events where id = v_event;
  assert n = 3, 'gift event records 3 diamonds';
  select count(*) into n from public.wallet_transactions where user_id = b;
  assert n = 0, 'other people''s ledger is invisible';
  reset role;
  select count(*) into n from public.wallet_transactions where user_id = b and kind = 'gift_received' and amount = 3;
  assert n = 1, 'host ledger has the diamond credit';
  set local role authenticated;
  select count(*) into n from public.get_live_top_gifters(v_stream, 5) where user_id = a and coins = 3;
  assert n = 1, 'top gifters lists the sender';
  begin
    perform public.send_live_gift(v_stream, 'crown', 1); -- 999 coins, only 147 left
    assert false, 'insufficient coins';
  exception when assert_failure then raise; when others then assert sqlerrm = 'insufficient_coins', concat('insuff err ', sqlerrm); end;
  for i in 1..29 loop
    perform public.send_live_gift(v_stream, 'rose', 1);
  end loop;
  begin
    perform public.send_live_gift(v_stream, 'rose', 1);
    assert false, 'gift rate limit';
  exception when assert_failure then raise; when others then assert sqlerrm = 'rate_limited', concat('rl err ', sqlerrm); end;
  begin
    perform public.send_live_gift(v_stream, 'rose', 100);
    assert false, 'quantity cap';
  exception when assert_failure then raise; when others then assert sqlerrm = 'invalid_quantity', concat('qty err ', sqlerrm); end;
  reset role;
  -- cannot gift self (host gifting their own room)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_live_gift(v_stream, 'rose', 1);
    assert false, 'cannot gift self';
  exception when assert_failure then raise; when others then assert sqlerrm = 'cannot_gift_self', concat('self err ', sqlerrm); end;
  perform public.end_live(v_stream);
  begin
    perform public.send_live_gift(v_stream, 'rose', 1);
    assert false, 'ended stream';
  exception when assert_failure then raise; when others then assert sqlerrm = 'stream_ended', concat('ended err ', sqlerrm); end;
  reset role;
  log := log || ' gifts+ratelimit';

  -- Ledger is append-only
  begin
    update public.wallet_transactions set amount = 0 where user_id = a;
    assert false, 'ledger update blocked';
  exception when assert_failure then raise; when others then assert sqlerrm = 'wallet_ledger_append_only', concat('upd err ', sqlerrm); end;
  begin
    delete from public.wallet_transactions where user_id = a;
    assert false, 'ledger delete blocked';
  exception when assert_failure then raise; when others then assert sqlerrm = 'wallet_ledger_append_only', concat('del err ', sqlerrm); end;

  -- Refund claw-back
  set local role service_role;
  j := public.reverse_coin_purchase('store-tx-1');
  assert (j->>'ok')::boolean and (j->>'reversed')::int = 100, concat('reverse ', j);
  j := public.reverse_coin_purchase('store-tx-1');
  assert (j->>'duplicate')::boolean, 'reverse is idempotent';
  reset role;
  select coins into bal from public.wallets where user_id = a;
  assert bal = 18, concat('after reverse balance=', bal); -- 150 - 32 roses - 100 refund
  log := log || ' reverse';

  -- Non-admin cannot grant
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_grant_coins(c, 10, 'nope');
    assert false, 'non-admin grant';
  exception when assert_failure then raise; when others then assert sqlerrm = 'not_admin', concat('admin err ', sqlerrm); end;
  reset role;
  log := log || ' admin';

  raise exception 'WALLET_TESTS_PASSED:%', log;
end $$;
