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
  kind: 'purchase' | 'purchase_reversal' | 'gift_sent' | 'gift_received' | 'adjustment';
  product_id: string | null;
  note: string | null;
  created_at: string;
};
export type CoinPack = { product_id: string; coins: number; sort: number };
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
  if (msg.includes('insufficient_coins')) return 'Not enough coins — top up in your wallet';
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
};

export const fmtCoins = (n: number) => n.toLocaleString('en-US');
