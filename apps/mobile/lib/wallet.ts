import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * MATCH coins wallet + live gifts. Read-only from the client: balances change only
 * inside SECURITY DEFINER functions (send_live_gift) or the revenuecat-webhook.
 */

export type Wallet = { coins: number; diamonds: number };
export type WalletTx = {
  id: string;
  currency: 'coins' | 'diamonds';
  amount: number;
  balance_after: number;
  kind: TxKind;
  product_id: string | null;
  note: string | null;
  created_at: string;
};
export type TxKind = 'purchase' | 'purchase_reversal' | 'gift_sent' | 'gift_received' | 'adjustment' | 'reward' | 'boost';
export type CoinPack = { product_id: string; coins: number; sort: number; reference_price?: string | null; bonus_pct?: number };
export type Gift = { id: string; name: string; emoji: string; coin_price: number; diamond_value: number; animation: 'float' | 'burst' | 'rain' | 'fullscreen'; sort: number };
export type GiftEvent = { id: string; giftId: string; senderId: string | null; senderName: string; quantity: number; coins: number; createdAt: string };
export type TopGifter = { userId: string; name: string; coins: number; gifts: number };

export async function fetchWallet(userId: string): Promise<Wallet> {
  const { data } = await supabase.from('wallets').select('coins, diamonds').eq('user_id', userId).maybeSingle();
  return { coins: Number(data?.coins ?? 0), diamonds: Number(data?.diamonds ?? 0) };
}

export async function fetchWalletHistory(limit = 40): Promise<WalletTx[]> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('id, currency, amount, balance_after, kind, product_id, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount), balance_after: Number(r.balance_after) })) as WalletTx[];
}

export async function fetchCoinPacks(): Promise<CoinPack[]> {
  const { data } = await supabase.from('coin_packs').select('product_id, coins, sort').order('sort');
  return (data ?? []) as CoinPack[];
}

let giftCache: Gift[] | null = null;
export async function fetchGifts(): Promise<Gift[]> {
  if (giftCache?.length) return giftCache;
  const { data } = await supabase.from('gifts').select('id, name, emoji, coin_price, diamond_value, animation, sort').order('sort');
  giftCache = (data ?? []) as Gift[];
  return giftCache;
}

export async function sendLiveGift(streamId: string, giftId: string, quantity = 1): Promise<{ eventId: string; coins: number }> {
  const { data, error } = await supabase.rpc('send_live_gift', { p_stream_id: streamId, p_gift_id: giftId, p_quantity: quantity });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { gift_event_id: string; coins_balance: number } | null;
  return { eventId: row?.gift_event_id ?? '', coins: Number(row?.coins_balance ?? 0) };
}

export async function fetchTopGifters(streamId: string, limit = 10): Promise<TopGifter[]> {
  const { data, error } = await supabase.rpc('get_live_top_gifters', { p_stream_id: streamId, p_limit: limit });
  if (error) return [];
  return ((data ?? []) as { user_id: string; name: string; coins: number; gifts: number }[]).map((r) => ({
    userId: r.user_id,
    name: r.name,
    coins: Number(r.coins),
    gifts: Number(r.gifts),
  }));
}

/** Every viewer gets every gift in this room (RLS: live_can_see) → animated overlay. */
export function subscribeLiveGifts(streamId: string, onGift: (g: GiftEvent) => void): () => void {
  const names: Record<string, string> = {};
  const channel: RealtimeChannel = supabase
    .channel(`gifts:${streamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gift_events', filter: `live_stream_id=eq.${streamId}` }, async (p) => {
      const r = p.new as { id: string; gift_id: string; sender_id: string | null; quantity: number; coins: number; created_at: string };
      if (r.sender_id && !names[r.sender_id]) {
        const { data } = await supabase.from('profiles').select('name').eq('id', r.sender_id).maybeSingle();
        names[r.sender_id] = (data?.name as string) || 'Someone';
      }
      onGift({ id: r.id, giftId: r.gift_id, senderId: r.sender_id, senderName: r.sender_id ? names[r.sender_id] : 'Someone', quantity: r.quantity, coins: r.coins, createdAt: r.created_at });
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function giftErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('insufficient_coins')) return 'Not enough coins — tap Top up';
  if (msg.includes('rate_limited')) return 'Easy there — try again in a moment';
  if (msg.includes('cannot_gift_self')) return "You can't gift your own live";
  if (msg.includes('stream_ended')) return 'This live has ended';
  if (msg.includes('not_allowed')) return "You can't send gifts here";
  return 'Gift failed — try again';
}

export const txLabel: Record<WalletTx['kind'], string> = {
  purchase: 'Coin pack',
  purchase_reversal: 'Refund',
  gift_sent: 'Gift sent',
  gift_received: 'Gift received',
  adjustment: 'Adjustment',
  reward: 'Reward',
  boost: 'Boost',
};

/* ------------------------------ wallet screen data ------------------------------ */

export type WalletOverview = {
  coins: number;
  diamonds: number;
  isAdmin: boolean;
  boostCoinPrice: number;
  boostMinutes: number;
  packs: CoinPack[];
};

export async function fetchWalletOverview(): Promise<WalletOverview> {
  const { data, error } = await supabase.rpc('get_wallet_overview');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  const packs = (Array.isArray(d.packs) ? d.packs : []) as { product_id: string; coins: number; reference_price: string | null; bonus_pct: number }[];
  return {
    coins: Number(d.coins ?? 0),
    diamonds: Number(d.diamonds ?? 0),
    isAdmin: !!d.is_admin,
    boostCoinPrice: Number(d.boost_coin_price ?? 150),
    boostMinutes: Number(d.boost_minutes ?? 30),
    packs: packs.map((p, i) => ({ product_id: p.product_id, coins: Number(p.coins), sort: i, reference_price: p.reference_price, bonus_pct: Number(p.bonus_pct ?? 0) })),
  };
}

export type HistoryRow = {
  id: string;
  currency: 'coins' | 'diamonds';
  amount: number;
  balanceAfter: number;
  kind: TxKind;
  title: string;
  subtitle: string | null;
  emoji: string;
  createdAt: string;
};
export type HistoryFilter = 'all' | 'purchases' | 'gifts' | 'rewards';
export const HISTORY_FILTERS: { id: HistoryFilter; label: string; kinds: TxKind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'purchases', label: 'Purchases', kinds: ['purchase', 'purchase_reversal'] },
  { id: 'gifts', label: 'Gifts', kinds: ['gift_sent', 'gift_received'] },
  { id: 'rewards', label: 'Rewards & boosts', kinds: ['reward', 'boost', 'adjustment'] },
];

export async function fetchHistory(limit = 50, before: string | null = null): Promise<HistoryRow[]> {
  const { data, error } = await supabase.rpc('get_wallet_history', { p_limit: limit, p_before: before });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    currency: r.currency as 'coins' | 'diamonds',
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    kind: r.kind as TxKind,
    title: String(r.title ?? ''),
    subtitle: (r.subtitle as string | null) ?? null,
    emoji: String(r.emoji ?? '🪙'),
    createdAt: String(r.created_at),
  }));
}

/** Admin-only test coins (server checks is_admin). Never available to normal users. */
export async function grantTestCoins(userId: string, amount = 500): Promise<number> {
  const { data, error } = await supabase.rpc('admin_grant_coins', { p_user: userId, p_amount: amount, p_note: 'Test coins (admin)' });
  if (error) throw error;
  return Number(data ?? 0);
}

/* ------------------------------ daily streak ------------------------------ */

export type DailyReward = {
  claimedToday: boolean;
  streak: number;
  dayInWeek: number;
  todayCoins: number;
  tomorrowCoins: number;
  schedule: number[];
  eligible: boolean;
};
function toDaily(d: Record<string, unknown>): DailyReward {
  return {
    claimedToday: !!d.claimed_today,
    streak: Number(d.streak ?? 0),
    dayInWeek: Number(d.day_in_week ?? 1),
    todayCoins: Number(d.today_coins ?? 0),
    tomorrowCoins: Number(d.tomorrow_coins ?? 0),
    schedule: (Array.isArray(d.schedule) ? d.schedule : [5, 5, 5, 5, 5, 5, 25]).map(Number),
    eligible: d.eligible !== false,
  };
}
export async function fetchDailyReward(): Promise<DailyReward> {
  const { data, error } = await supabase.rpc('get_daily_reward');
  if (error) throw error;
  return toDaily((data ?? {}) as Record<string, unknown>);
}
export async function claimDailyReward(): Promise<DailyReward & { claimed: boolean; coins: number; balance: number | null }> {
  const { data, error } = await supabase.rpc('claim_daily_reward');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return { ...toDaily(d), claimed: !!d.claimed, coins: Number(d.coins ?? 0), balance: d.balance == null ? null : Number(d.balance) };
}

/* ------------------------------ referrals ------------------------------ */

export type Referral = {
  code: string;
  coins: number;
  invited: number;
  rewarded: number;
  maxRewards: number;
  canRedeem: boolean;
  redeemed: { referrerName: string; rewarded: boolean; missing: string[] } | null;
};
export async function fetchReferral(): Promise<Referral> {
  const { data, error } = await supabase.rpc('get_my_referral');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  const r = d.redeemed as { referrer_name?: string; rewarded?: boolean; missing?: string[] } | null;
  return {
    code: String(d.code ?? ''),
    coins: Number(d.coins ?? 50),
    invited: Number(d.invited ?? 0),
    rewarded: Number(d.rewarded ?? 0),
    maxRewards: Number(d.max_rewards ?? 20),
    canRedeem: !!d.can_redeem,
    redeemed: r ? { referrerName: r.referrer_name || 'a friend', rewarded: !!r.rewarded, missing: r.missing ?? [] } : null,
  };
}
export async function redeemReferral(code: string): Promise<{ rewarded: boolean; coins: number; referrerName: string; missing: string[] }> {
  const { data, error } = await supabase.rpc('redeem_referral', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return { rewarded: !!d.rewarded, coins: Number(d.coins ?? 50), referrerName: String(d.referrer_name ?? 'your friend'), missing: (d.missing as string[]) ?? [] };
}
export function referralErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('invalid_code')) return "That code doesn't work — check it with your friend";
  if (msg.includes('own_code')) return "That's your own code — share it with a friend instead";
  if (msg.includes('already_redeemed')) return "You've already used an invite code";
  if (msg.includes('redeem_window_closed')) return 'Invite codes can be used in your first week only';
  if (msg.includes('rate_limited')) return 'Too many tries — wait a bit';
  return "Couldn't use that code — try again";
}
export function inviteMessage(code: string, coins: number): string {
  return `Join me on MATCH, the dating app for people who actually want to meet. Use my invite code ${code} after you sign up and we both get ${coins} coins 🪙`;
}

/* ------------------------------ completeness ------------------------------ */

export type CompletenessItem = { key: 'photo' | 'bio' | 'interests' | 'friday' | 'intention' | 'photos3' | 'city'; label: string; weight: number; done: boolean; hint: string };
export type Completeness = { score: number; items: CompletenessItem[]; liveReady: boolean };
export async function fetchCompleteness(): Promise<Completeness> {
  const { data, error } = await supabase.rpc('get_profile_completeness');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return { score: Number(d.score ?? 0), items: (d.items as CompletenessItem[]) ?? [], liveReady: !!d.live_ready };
}
export const nextStep = (c: Completeness | null) => c?.items.find((i) => !i.done) ?? null;

/* ------------------------------ boost with coins ------------------------------ */

export async function boostWithCoins(): Promise<{ endsAt: string; balance: number; price: number }> {
  const { data, error } = await supabase.rpc('activate_boost_with_coins');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return { endsAt: String(d.ends_at), balance: Number(d.balance ?? 0), price: Number(d.price ?? 0) };
}
export function boostCoinsError(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('insufficient_coins')) return 'Not enough coins for a boost — top up first';
  if (msg.includes('boost_active')) return 'A boost is already running';
  if (msg.includes('not_discoverable')) return "Boosts don't work while you're hidden or incognito";
  if (msg.includes('rate_limited')) return "That's enough boosts for today";
  return "Couldn't start the boost — try again";
}

export const fmtCoins = (n: number) => n.toLocaleString('en-US');
