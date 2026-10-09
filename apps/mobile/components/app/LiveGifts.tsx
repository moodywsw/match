import { LinearGradient } from 'expo-linear-gradient';
import { Coins, Crown } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Pressable, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Chip, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchGifts,
  fetchTopGifters,
  fetchWallet,
  fmtCoins,
  giftErrorMessage,
  sendLiveGift,
  subscribeLiveGifts,
  type Gift,
  type GiftEvent,
  type TopGifter,
} from '@/lib/wallet';

import { WalletSheet } from './WalletSheet';

/** Same catalogue as the seed in 20261008_wallet_gifts.sql (used by demo rooms / before it loads). */
const FALLBACK_GIFTS: Gift[] = [
  { id: 'rose', name: 'Rose', emoji: '🌹', coin_price: 1, diamond_value: 1, animation: 'float', sort: 1 },
  { id: 'heart', name: 'Heart', emoji: '❤️', coin_price: 5, diamond_value: 5, animation: 'float', sort: 2 },
  { id: 'spark', name: 'Spark', emoji: '✨', coin_price: 10, diamond_value: 10, animation: 'burst', sort: 3 },
  { id: 'flame', name: 'Flame', emoji: '🔥', coin_price: 25, diamond_value: 25, animation: 'burst', sort: 4 },
  { id: 'kiss', name: 'Kiss', emoji: '💋', coin_price: 49, diamond_value: 49, animation: 'burst', sort: 5 },
  { id: 'ring', name: 'Ring', emoji: '💍', coin_price: 99, diamond_value: 99, animation: 'rain', sort: 6 },
  { id: 'champagne', name: 'Champagne', emoji: '🍾', coin_price: 199, diamond_value: 199, animation: 'rain', sort: 7 },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', coin_price: 499, diamond_value: 499, animation: 'fullscreen', sort: 8 },
  { id: 'crown', name: 'Crown', emoji: '👑', coin_price: 999, diamond_value: 999, animation: 'fullscreen', sort: 9 },
];

export type GiftShow = { id: string; gift: Gift; sender: string; quantity: number };

function useCatalogue() {
  const [gifts, setGifts] = useState<Gift[]>(FALLBACK_GIFTS);
  useEffect(() => {
    fetchGifts()
      .then((g) => g.length && setGifts(g))
      .catch(() => {});
  }, []);
  return gifts;
}

/** Realtime gift feed for one live: overlay queue + top gifters leaderboard. */
export function useGiftFeed(streamId: string, real: boolean) {
  const gifts = useCatalogue();
  const byId = useMemo(() => Object.fromEntries(gifts.map((g) => [g.id, g])), [gifts]);
  const [queue, setQueue] = useState<GiftShow[]>([]);
  const [top, setTop] = useState<TopGifter[]>([]);
  const seen = useRef(new Set<string>());

  const enqueue = useCallback((s: GiftShow) => {
    if (seen.current.has(s.id)) return;
    seen.current.add(s.id);
    setQueue((q) => [...q, s].slice(-20));
  }, []);

  const refreshTop = useCallback(() => {
    if (!real) return;
    fetchTopGifters(streamId, 10)
      .then(setTop)
      .catch(() => {});
  }, [real, streamId]);

  useEffect(() => {
    if (!real) return;
    refreshTop();
    const unsub = subscribeLiveGifts(streamId, (e: GiftEvent) => {
      const gift = byId[e.giftId];
      if (gift) enqueue({ id: e.id, gift, sender: e.senderName, quantity: e.quantity });
      refreshTop();
    });
    const iv = setInterval(refreshTop, 30000);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, [real, streamId, byId, enqueue, refreshTop]);

  const done = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { gifts, current: queue[0] ?? null, done, enqueue, top, refreshTop };
}

/* ------------------------------ gift sheet ------------------------------ */

export function GiftSheet({
  visible,
  onClose,
  streamId,
  real,
  gifts,
  hostName,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  streamId: string;
  real: boolean;
  gifts: Gift[];
  hostName: string;
  onSent: (s: GiftShow) => void;
}) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [coins, setCoins] = useState<number | null>(null);
  const [pick, setPick] = useState<Gift | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id || !real) return;
    fetchWallet(user.id)
      .then((w) => setCoins(w.coins))
      .catch(() => {});
  }, [visible, user?.id, real, wallet]);

  const cost = (pick?.coin_price ?? 0) * qty;
  const short = real && coins != null && cost > coins;

  const send = async () => {
    if (!pick || busy) return;
    if (!real) {
      onSent({ id: `demo-${Date.now()}`, gift: pick, sender: 'You', quantity: qty });
      toast('Preview — gifts spend coins in real lives');
      onClose();
      return;
    }
    if (short) {
      setWallet(true);
      return;
    }
    setBusy(true);
    try {
      const r = await sendLiveGift(streamId, pick.id, qty);
      setCoins(r.coins);
      onSent({ id: r.eventId, gift: pick, sender: 'You', quantity: qty });
      onClose();
    } catch (e) {
      if (String((e as { message?: string })?.message ?? '').includes('insufficient_coins')) setWallet(true);
      else toast(giftErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet visible={visible && !wallet} onClose={onClose} scrim={T.scrimDeep} title={`Send ${hostName} a gift`} icon={<Txt size={18}>🎁</Txt>}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8, marginBottom: 14 }}>
          <Coins size={14} color={T.amber} />
          <Txt size={12.5} color={T.amber} w={600} style={{ flex: 1 }}>
            {real ? (coins == null ? '…' : `${fmtCoins(coins)} coins`) : 'Preview room'}
          </Txt>
          {real ? (
            <Pressable
              onPress={() => setWallet(true)}
              accessibilityRole="button"
              accessibilityLabel="Top up coins"
              style={({ pressed }) => ({ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: `${T.amber}22`, borderWidth: 1, borderColor: `${T.amber}66`, opacity: pressed ? 0.8 : 1 })}>
              <Txt w={700} size={12} color={T.amber}>
                + Top up
              </Txt>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {gifts.map((g) => {
            const on = pick?.id === g.id;
            return (
              <Pressable
                key={g.id}
                onPress={() => setPick(g)}
                accessibilityLabel={`${g.name}, ${g.coin_price} coins`}
                style={{
                  opacity: real && coins != null && g.coin_price > coins && !on ? 0.5 : 1,
                  width: '31%',
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderRadius: 16,
                  backgroundColor: on ? `${T.rose}22` : T.surface2,
                  borderWidth: 1,
                  borderColor: on ? T.rose : T.border,
                }}>
                <Txt size={28}>{g.emoji}</Txt>
                <Txt size={12} w={600} style={{ marginTop: 4 }}>
                  {g.name}
                </Txt>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  <Coins size={10} color={T.amber} />
                  <Txt v="mono" size={10.5} color={T.amber}>
                    {fmtCoins(g.coin_price)}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {[1, 5, 10].map((n) => (
            <Chip key={n} label={`×${n}`} active={qty === n} onPress={() => setQty(n)} small />
          ))}
        </View>
        {short ? (
          <Txt size={12} color={T.amber} style={{ marginBottom: 10 }}>
            Low balance: you have {fmtCoins(coins ?? 0)} coins and this costs {fmtCoins(cost)}.
          </Txt>
        ) : null}
        <PrimaryButton
          label={!pick ? 'Pick a gift' : short ? `Top up · need ${fmtCoins(cost - (coins ?? 0))} more` : `Send ${pick.emoji} ×${qty} · ${fmtCoins(cost)} coins`}
          disabled={!pick}
          loading={busy}
          onPress={send}
        />
      </Sheet>
      <WalletSheet visible={wallet} onClose={() => setWallet(false)} need={short ? cost : undefined} />
    </>
  );
}

/* ------------------------------ overlay ------------------------------ */

const { width: W, height: H } = Dimensions.get('window');

/** Plays one gift at a time for everyone in the room (float / burst / rain / fullscreen). */
export function GiftOverlay({ show, onDone }: { show: GiftShow | null; onDone: () => void }) {
  if (!show) return null;
  return <GiftAnim key={show.id} show={show} onDone={onDone} />;
}

function GiftAnim({ show, onDone }: { show: GiftShow; onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const kind = show.gift.animation;
  const duration = kind === 'float' ? 2200 : kind === 'burst' ? 2000 : kind === 'rain' ? 2800 : 3200;
  useEffect(() => {
    const a = Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true });
    a.start(({ finished }) => finished && onDone());
    return () => a.stop();
  }, [t, duration, onDone]);

  const n = Math.min(show.quantity, kind === 'rain' ? 1 : 6);
  const parts = useMemo(() => Array.from({ length: kind === 'rain' ? 16 : n }, (_, i) => ({ i, x: Math.random(), d: Math.random() })), [kind, n]);
  const banner = (
    <Animated.View
      style={[
        styles.banner,
        {
          opacity: t.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateX: t.interpolate({ inputRange: [0, 0.08, 1], outputRange: [-40, 0, 0] }) }],
        },
      ]}>
      <LinearGradient colors={[`${T.rose}EE`, `${T.violet}CC`]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.bannerInner}>
        <Txt w={700} size={12.5} color="#fff" numberOfLines={1}>
          {show.sender}
        </Txt>
        <Txt size={12} color="rgba(255,255,255,0.85)">
          sent {show.gift.name}
        </Txt>
        <Txt size={22}>{show.gift.emoji}</Txt>
        {show.quantity > 1 ? (
          <Txt v="display" size={18} color={T.amber}>
            ×{show.quantity}
          </Txt>
        ) : null}
      </LinearGradient>
    </Animated.View>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {kind === 'float'
        ? parts.map(({ i, x }) => {
            const s = i * 0.08;
            return (
              <Animated.Text
                key={i}
                style={{
                  position: 'absolute',
                  right: 30 + x * 50,
                  bottom: 130,
                  fontSize: 34,
                  opacity: t.interpolate({ inputRange: [0, s, s + 0.1, 0.85, 1], outputRange: [0, 0, 1, 0.9, 0], extrapolate: 'clamp' }),
                  transform: [
                    { translateY: t.interpolate({ inputRange: [0, s, 1], outputRange: [0, 0, -H * 0.45], extrapolate: 'clamp' }) },
                    { translateX: t.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0, -14 + x * 8, 12, -6] }) },
                    { scale: t.interpolate({ inputRange: [0, s + 0.1, 1], outputRange: [0.4, 1.1, 0.9], extrapolate: 'clamp' }) },
                  ],
                }}>
                {show.gift.emoji}
              </Animated.Text>
            );
          })
        : null}
      {kind === 'burst' ? (
        <View style={{ position: 'absolute', left: W / 2 - 40, top: H * 0.38 - 40, width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
          {Array.from({ length: 8 }, (_, i) => {
            const ang = (i / 8) * Math.PI * 2;
            return (
              <Animated.Text
                key={i}
                style={{
                  position: 'absolute',
                  fontSize: 20,
                  opacity: t.interpolate({ inputRange: [0, 0.15, 0.6, 0.8], outputRange: [0, 1, 0.8, 0], extrapolate: 'clamp' }),
                  transform: [
                    { translateX: t.interpolate({ inputRange: [0, 0.6], outputRange: [0, Math.cos(ang) * 110], extrapolate: 'clamp' }) },
                    { translateY: t.interpolate({ inputRange: [0, 0.6], outputRange: [0, Math.sin(ang) * 110], extrapolate: 'clamp' }) },
                  ],
                }}>
                {show.gift.emoji}
              </Animated.Text>
            );
          })}
          <Animated.Text
            style={{
              fontSize: 64,
              opacity: t.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ scale: t.interpolate({ inputRange: [0, 0.15, 0.3, 1], outputRange: [0.2, 1.5, 1, 1.05] }) }],
            }}>
            {show.gift.emoji}
          </Animated.Text>
        </View>
      ) : null}
      {kind === 'rain'
        ? parts.map(({ i, x, d }) => (
            <Animated.Text
              key={i}
              style={{
                position: 'absolute',
                left: x * (W - 40),
                top: -50,
                fontSize: 22 + d * 16,
                opacity: t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-d * 200, H * (0.7 + d * 0.3)] }) },
                  { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(d - 0.5) * 120}deg`] }) },
                ],
              }}>
              {show.gift.emoji}
            </Animated.Text>
          ))
        : null}
      {kind === 'fullscreen' ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,8,14,0.55)', opacity: t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }) }]} />
          <Animated.View
            style={{
              position: 'absolute',
              left: W / 2 - 160,
              top: H * 0.36 - 160,
              width: 320,
              height: 320,
              borderRadius: 160,
              backgroundColor: `${T.amber}33`,
              opacity: t.interpolate({ inputRange: [0, 0.15, 0.5, 0.85, 1], outputRange: [0, 0.9, 0.5, 0.8, 0] }),
              transform: [{ scale: t.interpolate({ inputRange: [0, 0.2, 0.5, 0.8, 1], outputRange: [0.3, 1, 0.85, 1.05, 1.2] }) }],
            }}
          />
          <Animated.Text
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: H * 0.36 - 60,
              fontSize: 110,
              opacity: t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { scale: t.interpolate({ inputRange: [0, 0.18, 0.3, 1], outputRange: [0.2, 1.25, 1, 1.08] }) },
                { translateY: t.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [60, 0, -8, kind === 'fullscreen' && show.gift.id === 'rocket' ? -H * 0.5 : 0] }) },
              ],
            }}>
            {show.gift.emoji}
          </Animated.Text>
        </>
      ) : null}
      {banner}
    </View>
  );
}

/* ------------------------------ top gifters ------------------------------ */

export function TopGiftersPill({ top, onPress }: { top: TopGifter[]; onPress: () => void }) {
  if (!top.length) return null;
  const lead = top[0];
  return (
    <Pressable onPress={onPress} style={styles.topPill} accessibilityRole="button" accessibilityLabel="Top gifters">
      <Crown size={13} color={T.amber} />
      <Txt size={11.5} w={700} color="#fff" numberOfLines={1} style={{ maxWidth: 110 }}>
        {lead.name}
      </Txt>
      <Txt v="mono" size={10.5} color={T.amber}>
        {fmtCoins(lead.coins)}
      </Txt>
    </Pressable>
  );
}

export function TopGiftersSheet({ visible, onClose, top }: { visible: boolean; onClose: () => void; top: TopGifter[] }) {
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Top gifters" icon={<Crown size={18} color={T.amber} />}>
      {top.map((g, i) => (
        <View key={g.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border }}>
          <Txt v="display" size={18} color={i === 0 ? T.amber : i === 1 ? '#D9D4E4' : i === 2 ? T.coral : T.muted} style={{ width: 24 }}>
            {i + 1}
          </Txt>
          <Txt size={14} w={600} style={{ flex: 1 }} numberOfLines={1}>
            {g.name}
          </Txt>
          <Coins size={13} color={T.amber} />
          <Txt v="mono" size={13} color={T.amber}>
            {fmtCoins(g.coins)}
          </Txt>
        </View>
      ))}
      {!top.length ? (
        <Txt size={13} color={T.mutedDim}>
          No gifts yet — be the first 🎁
        </Txt>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: { position: 'absolute', left: 12, top: H * 0.3 },
  bannerInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingLeft: 12, paddingRight: 14, borderRadius: 999 },
  topPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(30,25,40,0.75)',
    borderWidth: 1,
    borderColor: `${T.amber}55`,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
});
