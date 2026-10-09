-- Wallet history labels for speed-dating charges and refunds.
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
      when 'speed_date' then coalesce(t.note, 'Speed date')
      when 'speed_refund' then coalesce(t.note, 'Speed date refund')
      else coalesce(t.note, 'Adjustment')
    end,
    case t.kind
      when 'gift_sent' then 'to ' || case when e.receiver_id is null or public.is_blocked_either_way(t.user_id, e.receiver_id)
                                         then 'a member' else coalesce(pr.name, 'a member') end || ' · live'
      when 'gift_received' then 'from ' || case when e.sender_id is null or public.is_blocked_either_way(t.user_id, e.sender_id)
                                         then 'a member' else coalesce(ps.name, 'a member') end || ' · live'
      when 'purchase' then case when t.environment = 'SANDBOX' then 'Store purchase · test' else 'Store purchase' end
      when 'purchase_reversal' then 'Refunded by the store'
      when 'speed_date' then '1:1 video date'
      when 'speed_refund' then 'Coins back'
      else null
    end,
    case t.kind
      when 'purchase' then '🪙' when 'purchase_reversal' then '↩️'
      when 'gift_sent' then coalesce(g.emoji, '🎁') when 'gift_received' then coalesce(g.emoji, '🎁')
      when 'reward' then case when t.note ilike '%invite%' then '💌' else '🔥' end
      when 'boost' then '⚡' when 'speed_date' then '💞' when 'speed_refund' then '↩️' else '🛠️'
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
