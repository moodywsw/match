-- MATCH coins wallet + live gifts.
--
-- * coins    — bought with real money (RevenueCat consumables), spent on gifts.
-- * diamonds — earned by receiving gifts. Shown only; no cash-out yet (legal/KYC + store rules).
-- Balances live in public.wallets and change ONLY through private.wallet_apply(),
-- which also appends to public.wallet_transactions (append-only ledger). Clients have
-- SELECT on their own rows and nothing else; purchases are credited by the
-- revenuecat-webhook (service_role) only, idempotent per store transaction id.

-- ---------------------------------------------------------------------------
-- Catalogues
create table if not exists public.coin_packs (
  product_id text primary key check (product_id ~ '^[a-z0-9_.]{3,64}$'),
  coins integer not null check (coins between 1 and 1000000),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.coin_packs (product_id, coins, sort) values
  ('coins_100', 100, 1), ('coins_550', 550, 2), ('coins_1200', 1200, 3)
on conflict (product_id) do nothing;

create table if not exists public.gifts (
  id text primary key check (id ~ '^[a-z0-9_]{2,32}$'),
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null check (char_length(emoji) between 1 and 16),
  coin_price integer not null check (coin_price between 1 and 100000),
  diamond_value integer not null check (diamond_value >= 0 and diamond_value <= coin_price),
  animation text not null check (animation in ('float', 'burst', 'rain', 'fullscreen')),
  sort integer not null default 0,
  active boolean not null default true
);
insert into public.gifts (id, name, emoji, coin_price, diamond_value, animation, sort) values
  ('rose', 'Rose', '🌹', 1, 1, 'float', 1),
  ('heart', 'Heart', '❤️', 5, 5, 'float', 2),
  ('spark', 'Spark', '✨', 10, 10, 'burst', 3),
  ('flame', 'Flame', '🔥', 25, 25, 'burst', 4),
  ('kiss', 'Kiss', '💋', 49, 49, 'burst', 5),
  ('ring', 'Ring', '💍', 99, 99, 'rain', 6),
  ('champagne', 'Champagne', '🍾', 199, 199, 'rain', 7),
  ('rocket', 'Rocket', '🚀', 499, 499, 'fullscreen', 8),
  ('crown', 'Crown', '👑', 999, 999, 'fullscreen', 9)
on conflict (id) do nothing;

alter table public.coin_packs enable row level security;
alter table public.gifts enable row level security;
revoke all on public.coin_packs, public.gifts from anon, authenticated;
grant select on public.coin_packs, public.gifts to authenticated;
drop policy if exists "active coin packs are readable" on public.coin_packs;
create policy "active coin packs are readable" on public.coin_packs for select to authenticated using (active);
drop policy if exists "active gifts are readable" on public.gifts;
create policy "active gifts are readable" on public.gifts for select to authenticated using (active);

-- ---------------------------------------------------------------------------
-- Wallet + ledger
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  diamonds bigint not null default 0 check (diamonds >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  currency text not null check (currency in ('coins', 'diamonds')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind text not null check (kind in ('purchase', 'purchase_reversal', 'gift_sent', 'gift_received', 'adjustment')),
  gift_event_id uuid,          -- informational link to public.gift_events (no FK: the ledger is append-only)
  store_transaction_id text check (store_transaction_id is null or char_length(store_transaction_id) <= 200),
  product_id text check (product_id is null or char_length(product_id) <= 100),
  environment text check (environment is null or environment in ('SANDBOX', 'PRODUCTION')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_user_idx on public.wallet_transactions (user_id, created_at desc);
create unique index if not exists wallet_tx_store_uniq on public.wallet_transactions (store_transaction_id, kind)
  where store_transaction_id is not null;

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
revoke all on public.wallets, public.wallet_transactions from anon, authenticated;
grant select on public.wallets, public.wallet_transactions to authenticated;
drop policy if exists "own wallet" on public.wallets;
create policy "own wallet" on public.wallets for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own wallet transactions" on public.wallet_transactions;
create policy "own wallet transactions" on public.wallet_transactions for select to authenticated using (user_id = (select auth.uid()));

-- Append-only: no updates ever; deletes only via account deletion (profile cascade).
create or replace function private.wallet_tx_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'wallet_ledger_append_only' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = old.user_id) then
    raise exception 'wallet_ledger_append_only' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
drop trigger if exists wallet_tx_append_only on public.wallet_transactions;
create trigger wallet_tx_append_only before update or delete on public.wallet_transactions
  for each row execute function private.wallet_tx_append_only();

/** The only way a balance changes. Raises insufficient_coins / insufficient_diamonds. */
create or replace function private.wallet_apply(
  p_user uuid, p_currency text, p_amount bigint, p_kind text,
  p_gift_event uuid default null, p_store_tx text default null, p_product text default null,
  p_env text default null, p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal bigint;
begin
  if p_amount = 0 then
    select case when p_currency = 'coins' then w.coins else w.diamonds end into v_bal
      from public.wallets w where w.user_id = p_user;
    return coalesce(v_bal, 0);
  end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  if p_currency = 'coins' then
    update public.wallets set coins = coins + p_amount, updated_at = now()
     where user_id = p_user and coins + p_amount >= 0
    returning coins into v_bal;
  elsif p_currency = 'diamonds' then
    update public.wallets set diamonds = diamonds + p_amount, updated_at = now()
     where user_id = p_user and diamonds + p_amount >= 0
    returning diamonds into v_bal;
  else
    raise exception 'invalid_currency' using errcode = 'P0001';
  end if;
  if v_bal is null then
    raise exception '%', 'insufficient_' || p_currency using errcode = 'P0001';
  end if;
  insert into public.wallet_transactions
    (user_id, currency, amount, balance_after, kind, gift_event_id, store_transaction_id, product_id, environment, note)
  values (p_user, p_currency, p_amount, v_bal, p_kind, p_gift_event, p_store_tx, p_product, p_env, p_note);
  return v_bal;
end;
$$;
revoke all on function private.wallet_apply(uuid, text, bigint, text, uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gift events
create table if not exists public.gift_events (
  id uuid primary key default gen_random_uuid(),
  gift_id text not null references public.gifts(id),
  sender_id uuid references public.profiles(id) on delete set null,
  receiver_id uuid references public.profiles(id) on delete set null,
  live_stream_id uuid references public.live_streams(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  coins integer not null check (coins > 0),
  diamonds integer not null check (diamonds >= 0),
  created_at timestamptz not null default now()
);
create index if not exists gift_events_stream_idx on public.gift_events (live_stream_id, created_at desc);
create index if not exists gift_events_sender_idx on public.gift_events (sender_id, created_at desc);
create index if not exists gift_events_receiver_idx on public.gift_events (receiver_id, created_at desc);
create index if not exists gift_events_gift_idx on public.gift_events (gift_id);

alter table public.gift_events enable row level security;
revoke all on public.gift_events from anon, authenticated;
grant select on public.gift_events to authenticated;
drop policy if exists "gift events visible to parties and the live audience" on public.gift_events;
create policy "gift events visible to parties and the live audience" on public.gift_events
  for select to authenticated
  using (
    (select auth.uid()) in (sender_id, receiver_id)
    or (live_stream_id is not null and private.live_can_see(live_stream_id))
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gift_events') then
    alter publication supabase_realtime add table public.gift_events;
  end if;
end $$;

create or replace function private.send_live_gift(p_stream_id uuid, p_gift_id text, p_quantity integer default 1)
returns table (gift_event_id uuid, coins_balance bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  g public.gifts;
  v_host uuid;
  v_ended timestamptz;
  v_event uuid;
  v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  select * into g from public.gifts where id = p_gift_id and active;
  if not found then raise exception 'invalid_gift' using errcode = 'P0001'; end if;

  select s.host_id, s.ended_at into v_host, v_ended from public.live_streams s where s.id = p_stream_id;
  if not found then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if v_ended is not null or not private.live_is_active(p_stream_id) then
    raise exception 'stream_ended' using errcode = 'P0001';
  end if;
  if not private.live_can_see(p_stream_id) or private.is_hidden_user(v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_host = v_uid then raise exception 'cannot_gift_self' using errcode = 'P0001'; end if;

  perform private.hit_rate_limit('gift_min', 30, interval '1 minute');
  perform private.hit_rate_limit('gift_day', 1000, interval '1 day');

  insert into public.gift_events (gift_id, sender_id, receiver_id, live_stream_id, quantity, coins, diamonds)
  values (g.id, v_uid, v_host, p_stream_id, p_quantity, g.coin_price * p_quantity, g.diamond_value * p_quantity)
  returning id into v_event;

  v_bal := private.wallet_apply(v_uid, 'coins', -(g.coin_price * p_quantity)::bigint, 'gift_sent', v_event);
  if g.diamond_value > 0 then
    perform private.wallet_apply(v_host, 'diamonds', (g.diamond_value * p_quantity)::bigint, 'gift_received', v_event);
  end if;

  return query select v_event, v_bal;
end;
$$;

create or replace function private.get_live_top_gifters(p_stream_id uuid, p_limit integer default 10)
returns table (user_id uuid, name text, coins bigint, gifts bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.live_can_see(p_stream_id)
     and not exists (select 1 from public.live_streams s where s.id = p_stream_id and s.host_id = (select auth.uid())) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return query
    select e.sender_id, coalesce(p.name, 'Member'), sum(e.coins)::bigint, sum(e.quantity)::bigint
      from public.gift_events e
      left join public.profiles p on p.id = e.sender_id
     where e.live_stream_id = p_stream_id
       and e.sender_id is not null
       and not public.is_blocked_either_way((select auth.uid()), e.sender_id)
     group by e.sender_id, p.name
     order by 3 desc, 1
     limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

/** Admin-only manual adjustment (support, promos, testing before store products exist). */
create or replace function private.admin_grant_coins(p_user uuid, p_amount integer, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not_admin' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0001';
  end if;
  return private.wallet_apply(p_user, 'coins', p_amount, 'adjustment', null, null, null, null,
                              left(coalesce(nullif(trim(p_note), ''), 'admin adjustment'), 200));
end;
$$;

/** RevenueCat NON_RENEWING_PURCHASE → credit coins. Idempotent per store transaction id. service_role only. */
create or replace function private.credit_coin_purchase(p_user uuid, p_product_id text, p_store_tx text, p_env text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coins integer;
  v_bal bigint;
begin
  if p_store_tx is null or char_length(p_store_tx) = 0 then
    raise exception 'missing_transaction_id' using errcode = 'P0001';
  end if;
  select coins into v_coins from public.coin_packs where product_id = p_product_id;
  if v_coins is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_product');
  end if;
  if exists (select 1 from public.wallet_transactions where store_transaction_id = p_store_tx and kind = 'purchase') then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  begin
    v_bal := private.wallet_apply(p_user, 'coins', v_coins, 'purchase', null, p_store_tx, p_product_id,
                                  case when p_env in ('SANDBOX', 'PRODUCTION') then p_env end, null);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end;
  return jsonb_build_object('ok', true, 'coins', v_coins, 'balance', v_bal);
end;
$$;

/** Refund of a coin pack: take back what is still there (never below zero). service_role only. */
create or replace function private.reverse_coin_purchase(p_store_tx text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.wallet_transactions;
  v_have bigint;
  v_take bigint;
begin
  select * into t from public.wallet_transactions where store_transaction_id = p_store_tx and kind = 'purchase';
  if not found then return jsonb_build_object('ok', true, 'reason', 'no_purchase'); end if;
  if exists (select 1 from public.wallet_transactions where store_transaction_id = p_store_tx and kind = 'purchase_reversal') then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select coins into v_have from public.wallets where user_id = t.user_id for update;
  v_take := least(coalesce(v_have, 0), t.amount);
  if v_take > 0 then
    perform private.wallet_apply(t.user_id, 'coins', -v_take, 'purchase_reversal', null, p_store_tx, t.product_id, t.environment, 'store refund');
  end if;
  return jsonb_build_object('ok', true, 'reversed', v_take, 'uncollectable', t.amount - v_take);
end;
$$;

revoke all on function private.send_live_gift(uuid, text, integer) from public, anon;
revoke all on function private.get_live_top_gifters(uuid, integer) from public, anon;
revoke all on function private.admin_grant_coins(uuid, integer, text) from public, anon;
revoke all on function private.credit_coin_purchase(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.reverse_coin_purchase(text) from public, anon, authenticated;
grant execute on function private.send_live_gift(uuid, text, integer) to authenticated;
grant execute on function private.get_live_top_gifters(uuid, integer) to authenticated;
grant execute on function private.admin_grant_coins(uuid, integer, text) to authenticated;
grant usage on schema private to service_role;
grant execute on function private.credit_coin_purchase(uuid, text, text, text) to service_role;
grant execute on function private.reverse_coin_purchase(text) to service_role;

create or replace function public.send_live_gift(p_stream_id uuid, p_gift_id text, p_quantity integer default 1)
returns table (gift_event_id uuid, coins_balance bigint)
language sql security invoker set search_path = ''
as $$ select * from private.send_live_gift(p_stream_id, p_gift_id, p_quantity) $$;

create or replace function public.get_live_top_gifters(p_stream_id uuid, p_limit integer default 10)
returns table (user_id uuid, name text, coins bigint, gifts bigint)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_live_top_gifters(p_stream_id, p_limit) $$;

create or replace function public.admin_grant_coins(p_user uuid, p_amount integer, p_note text default null)
returns bigint
language sql security invoker set search_path = ''
as $$ select private.admin_grant_coins(p_user, p_amount, p_note) $$;

create or replace function public.credit_coin_purchase(p_user uuid, p_product_id text, p_store_tx text, p_env text default null)
returns jsonb
language sql security invoker set search_path = ''
as $$ select private.credit_coin_purchase(p_user, p_product_id, p_store_tx, p_env) $$;

create or replace function public.reverse_coin_purchase(p_store_tx text)
returns jsonb
language sql security invoker set search_path = ''
as $$ select private.reverse_coin_purchase(p_store_tx) $$;

revoke all on function public.send_live_gift(uuid, text, integer) from public, anon;
revoke all on function public.get_live_top_gifters(uuid, integer) from public, anon;
revoke all on function public.admin_grant_coins(uuid, integer, text) from public, anon;
revoke all on function public.credit_coin_purchase(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.reverse_coin_purchase(text) from public, anon, authenticated;
grant execute on function public.send_live_gift(uuid, text, integer) to authenticated;
grant execute on function public.get_live_top_gifters(uuid, integer) to authenticated;
grant execute on function public.admin_grant_coins(uuid, integer, text) to authenticated;
grant execute on function public.credit_coin_purchase(uuid, text, text, text) to service_role;
grant execute on function public.reverse_coin_purchase(text) to service_role;
