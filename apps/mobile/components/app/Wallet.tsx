import { useFocusEffect } from 'expo-router';
import { Check, Coins, Flame, Gem, Share2, Sparkles, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Share, TextInput, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { Chip, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { coinPurchaseStatus, loadCoinStore, purchaseCoinPack } from '@/lib/iap';
import { missingText } from '@/lib/live';
import {
  boostCoinsError,
  boostWithCoins,
  claimDailyReward,
  fetchCompleteness,
  fetchDailyReward,
  fetchHistory,
  fetchReferral,
  fetchWalletOverview,
  fmtCoins,
  grantTestCoins,
  HISTORY_FILTERS,
  inviteMessage,
  nextStep,
  redeemReferral,
  referralErrorMessage,
  type CoinPack,
  type Completeness,
  type CompletenessItem,
  type DailyReward,
  type HistoryFilter,
  type HistoryRow,
  type Referral,
  type WalletOverview,
} from '@/lib/wallet';

/* ---------------------------------------------------------------- shared bits */

type Notice = { text: string; tone: 'ok' | 'warn' } | null;

/** Inline notice: app toasts render under modals, so wallet UI shows its own. */
function useNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setNotice({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 3500);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { notice, show };
}

function NoticeBar({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const c = notice.tone === 'ok' ? T.mint : T.amber;
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 10, borderRadius: 12, backgroundColor: `${c}22`, borderWidth: 1, borderColor: `${c}55`, marginBottom: 12 }}>
      <Txt size={12.5} color={T.text}>
        {notice.text}
      </Txt>
    </View>
  );
}

function Label({ children, style }: { children: string; style?: object }) {
  return (
    <Txt v="mono" size={10.5} color={T.muted} style={[{ letterSpacing: 1, marginBottom: 8 }, style]}>
      {children}
    </Txt>
  );
}

const card = { backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 14 } as const;

/* ---------------------------------------------------------------- daily streak */

export function DailyRewardCard({ compact, onClaimed }: { compact?: boolean; onClaimed?: (coins: number, balance: number | null) => void }) {
  const [d, setD] = useState<DailyReward | null>(null);
  const [busy, setBusy] = useState(false);
  const [justGot, setJustGot] = useState<number | null>(null);

  const load = useCallback(() => {
    fetchDailyReward()
      .then(setD)
      .catch(() => setD(null));
  }, []);
  useFocusEffect(load);

  if (!d || !d.eligible) return null;
  if (compact && d.claimedToday && justGot == null) return null;

  const claim = async () => {
    if (busy || d.claimedToday) return;
    setBusy(true);
    try {
      const r = await claimDailyReward();
      setD(r);
      if (r.claimed) {
        setJustGot(r.coins);
        onClaimed?.(r.coins, r.balance);
      }
    } catch {
      // keep the card; the next focus reloads it
    } finally {
      setBusy(false);
    }
  };

  const streakNow = d.claimedToday ? d.streak : d.streak + 1;
  if (compact) {
    return (
      <Pressable
        onPress={claim}
        accessibilityRole="button"
        accessibilityLabel={justGot != null ? `Claimed ${justGot} coins` : `Claim ${d.todayCoins} coins, day ${streakNow} streak`}
        style={({ pressed }) => ({ ...card, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18, borderColor: `${T.amber}55`, opacity: pressed ? 0.85 : 1 })}>
        <Flame size={22} color={T.amber} />
        <View style={{ flex: 1 }}>
          <Txt w={700} size={13.5}>
            {justGot != null ? `+${justGot} coins · day ${d.streak} streak 🔥` : `Day ${streakNow} streak — your daily coins are ready`}
          </Txt>
          <Txt size={11.5} color={T.muted} style={{ marginTop: 2 }}>
            {justGot != null ? `Come back tomorrow for +${d.tomorrowCoins}` : `Open MATCH daily · day 7 pays ${d.schedule[6]}`}
          </Txt>
        </View>
        {justGot != null ? (
          <Check size={18} color={T.mint} />
        ) : busy ? (
          <ActivityIndicator color={T.amber} />
        ) : (
          <View style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: T.amber }}>
            <Txt w={700} size={12} color={T.ink}>
              +{d.todayCoins}
            </Txt>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <View style={{ ...card, marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Flame size={16} color={T.amber} />
        <Txt w={700} size={14} style={{ flex: 1 }}>
          Daily streak · {d.claimedToday ? d.streak : d.streak} day{d.streak === 1 ? '' : 's'}
        </Txt>
        {d.claimedToday ? (
          <Txt size={11.5} color={T.mint}>
            Claimed today ✓
          </Txt>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {d.schedule.map((c, i) => {
          const day = i + 1;
          const done = d.claimedToday ? day <= d.dayInWeek : day < d.dayInWeek;
          const today = day === d.dayInWeek;
          return (
            <View
              key={day}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: done ? `${T.amber}33` : T.surface3,
                borderWidth: 1,
                borderColor: today ? T.amber : 'transparent',
              }}>
              <Txt v="mono" size={9.5} color={T.mutedDim}>
                D{day}
              </Txt>
              <Txt w={700} size={12} color={done ? T.amber : T.text}>
                {c}
              </Txt>
            </View>
          );
        })}
      </View>
      {d.claimedToday ? (
        <Txt size={12} color={T.muted}>
          {justGot != null ? `+${justGot} coins added. ` : ''}Come back tomorrow for +{d.tomorrowCoins}. Miss a day and the streak restarts.
        </Txt>
      ) : (
        <PrimaryButton small label={`Claim +${d.todayCoins} coins`} loading={busy} onPress={claim} />
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- completeness */

export function CompletenessCard({ onFix, style }: { onFix: (item: CompletenessItem) => void; style?: object }) {
  const [c, setC] = useState<Completeness | null>(null);
  useFocusEffect(
    useCallback(() => {
      fetchCompleteness()
        .then(setC)
        .catch(() => setC(null));
    }, [])
  );
  if (!c) return null;
  const next = nextStep(c);
  const color = c.score >= 100 ? T.mint : c.score >= 70 ? T.amber : T.rose;
  return (
    <View style={[{ ...card, marginBottom: 16 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Txt w={700} size={14} style={{ flex: 1 }}>
          Profile strength
        </Txt>
        <Txt v="mono" w={600} size={13} color={color}>
          {c.score}%
        </Txt>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: T.surface3, overflow: 'hidden', marginBottom: 10 }}>
        <View style={{ width: `${Math.min(100, c.score)}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
      </View>
      {next ? (
        <Pressable onPress={() => onFix(next)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.8 : 1 })}>
          <Sparkles size={15} color={T.amber} />
          <View style={{ flex: 1 }}>
            <Txt w={600} size={13}>
              {next.label} <Txt size={12} color={T.mint}>+{next.weight}%</Txt>
            </Txt>
            <Txt size={11.5} color={T.muted} style={{ marginTop: 1 }}>
              {next.hint}
            </Txt>
          </View>
          <Txt w={700} size={12} color={T.rose}>
            Do it →
          </Txt>
        </Pressable>
      ) : (
        <Txt size={12} color={T.muted}>
          Your profile is complete. Nice! 🎉
        </Txt>
      )}
      {!c.liveReady && c.score < 100 ? (
        <Txt size={11} color={T.mutedDim} style={{ marginTop: 8 }}>
          A complete profile also unlocks commenting, gifts and hosting in Live.
        </Txt>
      ) : null}
    </View>
  );
}

/** One-line nudge (Home): only when something is missing. */
export function CompletenessNudge({ onPress }: { onPress: () => void }) {
  const [c, setC] = useState<Completeness | null>(null);
  useFocusEffect(
    useCallback(() => {
      fetchCompleteness()
        .then(setC)
        .catch(() => setC(null));
    }, [])
  );
  const next = nextStep(c);
  if (!c || !next || c.score >= 100) return null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: T.amber, alignItems: 'center', justifyContent: 'center' }}>
        <Txt v="mono" w={600} size={10.5}>
          {c.score}%
        </Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt w={600} size={13}>
          {next.label}
        </Txt>
        <Txt size={11.5} color={T.muted}>
          {next.hint}
        </Txt>
      </View>
      <Txt w={700} size={12} color={T.rose}>
        +{next.weight}%
      </Txt>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- invites */

export function InviteCard({ onReward }: { onReward?: () => void }) {
  const [r, setR] = useState<Referral | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const { notice, show } = useNotice();
  const load = useCallback(() => {
    fetchReferral()
      .then(setR)
      .catch(() => setR(null));
  }, []);
  useEffect(load, [load]);
  if (!r) return null;

  const share = () => {
    void Share.share({ message: inviteMessage(r.code, r.coins) }).catch(() => {});
  };
  const redeem = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const res = await redeemReferral(code);
      setCode('');
      if (res.rewarded) {
        show(`+${res.coins} coins — thanks for joining with ${res.referrerName}'s invite! 🎉`);
        onReward?.();
      } else {
        show(`Code saved. ${missingText(res.missing) || 'Finish your profile'} and you and ${res.referrerName} both get ${res.coins} coins.`);
      }
      load();
    } catch (err) {
      show(referralErrorMessage(err), 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ ...card, marginBottom: 18 }}>
      <NoticeBar notice={notice} />
      <Txt w={700} size={14}>
        💌 Invite friends, get {r.coins} coins each
      </Txt>
      <Txt size={12} color={T.muted} style={{ marginTop: 4, marginBottom: 12 }} lh={1.4}>
        When a friend signs up with your code and completes their profile, you both get {r.coins} coins.
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: `${T.rose}88`, backgroundColor: `${T.rose}11` }}>
          <Txt v="mono" w={600} size={18} selectable style={{ letterSpacing: 3 }} accessibilityLabel={`Your invite code ${r.code.split('').join(' ')}`}>
            {r.code}
          </Txt>
        </View>
        <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="Share invite" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 999, backgroundColor: T.rose, opacity: pressed ? 0.85 : 1 })}>
          <Share2 size={14} color="#fff" />
          <Txt w={700} size={13} color="#fff">
            Share
          </Txt>
        </Pressable>
      </View>
      <Txt size={11.5} color={T.mutedDim} style={{ marginTop: 8 }}>
        {r.invited === 0 ? 'No invites yet' : `${r.invited} joined · ${r.rewarded} rewarded`} · up to {r.maxRewards} rewarded invites
      </Txt>

      {r.redeemed ? (
        <Txt size={12} color={r.redeemed.rewarded ? T.mint : T.amber} style={{ marginTop: 12 }}>
          {r.redeemed.rewarded
            ? `You joined with ${r.redeemed.referrerName}'s invite ✓`
            : `Invite from ${r.redeemed.referrerName} saved. ${missingText(r.redeemed.missing) || 'Finish your profile'} to unlock ${r.coins} coins for you both.`}
        </Txt>
      ) : r.canRedeem ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
            placeholder="Got a friend's code?"
            placeholderTextColor={T.mutedDim}
            autoCapitalize="characters"
            autoCorrect={false}
            style={{ flex: 1, color: T.text, backgroundColor: T.surface3, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'IBMPlexMono_500Medium', letterSpacing: 2 }}
          />
          <Pressable onPress={() => void redeem()} accessibilityRole="button" accessibilityLabel="Use invite code" disabled={!code.trim() || busy} style={{ justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: code.trim() ? T.violet : T.surface3 }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Txt w={700} size={12.5} color="#fff">Use code</Txt>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- boost with coins */

export function BoostCoinsSheet({
  visible,
  onClose,
  onBoosted,
  onTopUp,
  onPremium,
  hasPlanBoost,
}: {
  visible: boolean;
  onClose: () => void;
  onBoosted: (endsAt: string) => void;
  onTopUp: (need: number) => void;
  onPremium?: () => void;
  hasPlanBoost?: boolean;
}) {
  const [o, setO] = useState<WalletOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const { notice, show } = useNotice();
  useEffect(() => {
    if (!visible) return;
    fetchWalletOverview()
      .then(setO)
      .catch(() => setO(null));
  }, [visible]);
  const price = o?.boostCoinPrice ?? 150;
  const short = o != null && o.coins < price;
  const go = async () => {
    if (busy) return;
    if (short) {
      onTopUp(price);
      return;
    }
    setBusy(true);
    try {
      const r = await boostWithCoins();
      onBoosted(r.endsAt);
      onClose();
    } catch (err) {
      show(boostCoinsError(err), 'warn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Boost your profile" icon={<Zap size={20} color={T.amber} />}>
      <NoticeBar notice={notice} />
      <Txt size={13} color={T.muted} lh={1.45} style={{ marginBottom: 14 }}>
        Be one of the first profiles people see in Discover for {o?.boostMinutes ?? 30} minutes. Works best in the evening.
      </Txt>
      <View style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Coins size={18} color={T.amber} />
        <Txt w={700} size={14} style={{ flex: 1 }}>
          {fmtCoins(price)} coins
        </Txt>
        <Txt size={12} color={short ? T.rose : T.muted}>
          You have {o ? fmtCoins(o.coins) : '…'}
        </Txt>
      </View>
      <PrimaryButton label={short ? `Top up · need ${fmtCoins(price - (o?.coins ?? 0))} more` : `Boost for ${fmtCoins(price)} coins`} loading={busy} onPress={go} />
      {!hasPlanBoost && onPremium ? (
        <Pressable onPress={onPremium} style={{ alignItems: 'center', marginTop: 14 }}>
          <Txt size={12.5} color={T.muted}>
            Or get a free boost every month with <Txt w={700} size={12.5} color={T.rose}>MATCH+</Txt>
          </Txt>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- wallet */

function PackRow({ pack, price, state, busy, highlight, onBuy }: { pack: CoinPack; price: string; state: 'buy' | 'soon' | 'app'; busy: boolean; highlight: boolean; onBuy: () => void }) {
  return (
    <Pressable
      onPress={onBuy}
      disabled={state !== 'buy' || busy}
      accessibilityRole="button"
      accessibilityLabel={`${pack.coins} coins for ${price}${state === 'soon' ? ', coming soon' : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 16,
        marginBottom: 8,
        backgroundColor: T.surface2,
        borderWidth: 1,
        borderColor: highlight ? T.amber : T.border,
        opacity: pressed ? 0.8 : 1,
      })}>
      <Txt size={22}>🪙</Txt>
      <View style={{ flex: 1 }}>
        <Txt w={700} size={14.5}>
          {fmtCoins(pack.coins)} coins
        </Txt>
        <Txt size={11} color={pack.bonus_pct ? T.mint : T.mutedDim}>
          {pack.bonus_pct ? `+${pack.bonus_pct}% bonus${pack.bonus_pct >= 20 ? ' · best value' : ''}` : 'Starter'}
          {highlight ? '  · enough for this' : ''}
        </Txt>
      </View>
      {busy ? (
        <ActivityIndicator color={T.text} />
      ) : (
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: state === 'buy' ? T.rose : T.surface3 }}>
            <Txt w={700} size={12.5} color={state === 'buy' ? '#fff' : T.muted}>
              {price}
            </Txt>
          </View>
          {state !== 'buy' ? (
            <Txt size={10} color={T.mutedDim} style={{ marginTop: 3 }}>
              {state === 'soon' ? 'Coming soon' : 'In the MATCH app'}
            </Txt>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** The whole wallet (screen + sheet). `need` = coins missing for what the user was doing. */
export function WalletView({ need }: { need?: number }) {
  const { user } = useAuth();
  const [o, setO] = useState<WalletOverview | null>(null);
  const [store, setStore] = useState<{ reachable: boolean; prices: Record<string, string> }>({ reachable: false, prices: {} });
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [buying, setBuying] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const { notice, show } = useNotice();
  const status = coinPurchaseStatus();

  const load = useCallback(async () => {
    const [ov, h] = await Promise.all([fetchWalletOverview().catch(() => null), fetchHistory(60).catch(() => null)]);
    if (ov) setO(ov);
    if (h) setHistory(h);
    return ov;
  }, []);

  useEffect(() => {
    void load().then((ov) => {
      if (ov?.packs.length) void loadCoinStore(ov.packs.map((p) => p.product_id)).then(setStore);
    });
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [load]);

  const buy = async (pack: CoinPack) => {
    if (buying) return;
    setBuying(pack.product_id);
    const before = o?.coins ?? 0;
    const r = await purchaseCoinPack(pack.product_id);
    setBuying(null);
    if (!r.ok) {
      if (!r.cancelled) show(r.error, 'warn');
      return;
    }
    show(`Payment done — adding ${fmtCoins(pack.coins)} coins 🪙`);
    // The store webhook credits the balance server-side; watch for it (~30 s).
    let tries = 0;
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      tries += 1;
      const ov = await load();
      if ((ov && ov.coins > before) || tries >= 15) {
        if (poll.current) clearInterval(poll.current);
        poll.current = null;
        if (!ov || ov.coins <= before) show('Your coins are on the way — they can take a minute to appear.', 'warn');
      }
    }, 2000);
  };

  const testCoins = async () => {
    if (!user?.id || granting) return;
    setGranting(true);
    try {
      await grantTestCoins(user.id, 500);
      show('+500 test coins (admin)');
      await load();
    } catch {
      show("Couldn't add test coins", 'warn');
    } finally {
      setGranting(false);
    }
  };

  const kinds = HISTORY_FILTERS.find((f) => f.id === filter)?.kinds;
  const rows = (history ?? []).filter((h) => !kinds || kinds.includes(h.kind));
  const highlightPack = need && need > 0 ? o?.packs.find((p) => p.coins >= need)?.product_id : undefined;

  return (
    <View>
      <NoticeBar notice={notice} />
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        <View style={{ flex: 1.3, padding: 14, borderRadius: 18, backgroundColor: T.surface2, borderWidth: 1, borderColor: `${T.amber}44` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Coins size={14} color={T.amber} />
            <Txt v="mono" size={10.5} color={T.amber} style={{ letterSpacing: 1 }}>
              COINS
            </Txt>
          </View>
          <Txt v="display" size={30} style={{ marginTop: 6 }} accessibilityLabel={`Balance ${o?.coins ?? 0} coins`}>
            {o ? fmtCoins(o.coins) : '—'}
          </Txt>
          <Txt size={11.5} color={T.mutedDim} style={{ marginTop: 2 }}>
            For gifts in lives and boosts
          </Txt>
        </View>
        <View style={{ flex: 1, padding: 14, borderRadius: 18, backgroundColor: T.surface2, borderWidth: 1, borderColor: `${T.violet}44` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Gem size={14} color={T.violet} />
            <Txt v="mono" size={10.5} color={T.violet} style={{ letterSpacing: 1 }}>
              DIAMONDS
            </Txt>
          </View>
          <Txt v="display" size={30} style={{ marginTop: 6 }}>
            {o ? fmtCoins(o.diamonds) : '—'}
          </Txt>
          <Txt size={11.5} color={T.mutedDim} style={{ marginTop: 2 }}>
            From gifts you received
          </Txt>
        </View>
      </View>

      {need && need > 0 && o && o.coins < need ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: `${T.amber}18`, borderWidth: 1, borderColor: `${T.amber}55`, marginBottom: 14 }}>
          <Txt size={12.5}>
            You need <Txt w={700} size={12.5} color={T.amber}>{fmtCoins(need - o.coins)} more coins</Txt> for that. Pick a pack below.
          </Txt>
        </View>
      ) : null}

      <Label>TOP UP</Label>
      {(o?.packs ?? []).map((p) => {
        const live = store.reachable && !!store.prices[p.product_id];
        const state: 'buy' | 'soon' | 'app' = live ? 'buy' : !status.enabled && status.message.includes('installed') ? 'app' : 'soon';
        return (
          <PackRow
            key={p.product_id}
            pack={p}
            price={store.prices[p.product_id] ?? p.reference_price ?? '—'}
            state={state}
            busy={buying === p.product_id}
            highlight={p.product_id === highlightPack}
            onBuy={() => void buy(p)}
          />
        );
      })}
      <Txt size={11} color={T.mutedDim} style={{ marginBottom: 6 }} lh={1.4}>
        {store.reachable
          ? 'Paid through Google Play / the App Store. The final price, including VAT, is shown at checkout.'
          : status.enabled
            ? 'Coin packs are coming soon. Prices shown are indicative, including VAT.'
            : `${status.message} Prices shown are indicative, including VAT.`}
      </Txt>
      {o?.isAdmin ? (
        <Pressable onPress={testCoins} disabled={granting} style={{ alignSelf: 'flex-start', marginTop: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: T.border }}>
          <Txt w={600} size={12} color={T.muted}>
            {granting ? 'Adding…' : '🛠️ Add 500 test coins (admin only)'}
          </Txt>
        </Pressable>
      ) : null}

      <Label style={{ marginTop: 18 }}>EARN FREE COINS</Label>
      <DailyRewardCard onClaimed={() => void load()} />
      <InviteCard onReward={() => void load()} />

      <Label>WHAT COINS DO</Label>
      <View style={{ ...card, marginBottom: 18, gap: 8 }}>
        <Txt size={12.5} color={T.text}>
          🎁 Send gifts in lives, from 🌹 1 coin to 👑 999 coins
        </Txt>
        <Txt size={12.5} color={T.text}>
          ⚡ Boost your profile for {o?.boostMinutes ?? 30} min · {fmtCoins(o?.boostCoinPrice ?? 150)} coins
        </Txt>
        <Txt size={12.5} color={T.text}>
          💞 Speed dates: your first 1:1 each day is free, then 50 coins · refunded if your date leaves early
        </Txt>
      </View>

      <Label>HISTORY</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {HISTORY_FILTERS.map((f) => (
          <Chip key={f.id} small label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </View>
      {history == null ? (
        <ActivityIndicator color={T.muted} style={{ marginVertical: 12 }} />
      ) : rows.length === 0 ? (
        <Txt size={12.5} color={T.mutedDim} style={{ marginVertical: 10 }}>
          {filter === 'all' ? 'No coin activity yet. Claim your daily coins above to get started.' : 'Nothing here yet.'}
        </Txt>
      ) : (
        rows.map((t) => (
          <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border, gap: 10 }}>
            <Txt size={18}>{t.emoji}</Txt>
            <View style={{ flex: 1 }}>
              <Txt size={13}>{t.title}</Txt>
              <Txt v="mono" size={10} color={T.mutedDim}>
                {[t.subtitle, new Date(t.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt v="mono" size={13} w={600} color={t.amount > 0 ? T.mint : T.text}>
                {t.amount > 0 ? '+' : ''}
                {fmtCoins(t.amount)}
                {t.currency === 'diamonds' ? ' 💎' : ''}
              </Txt>
            </View>
          </View>
        ))
      )}
      <Txt size={11} color={T.mutedDim} style={{ marginTop: 14 }} lh={1.4}>
        Coins are a digital item for use in MATCH only. You can only buy them through the app store. They can’t be exchanged for cash, refunded outside the store or transferred to other people. Diamonds show appreciation and can’t be cashed out.
      </Txt>
    </View>
  );
}

/** Wallet inside a modal (live room / gift sheet), where screen navigation would hide behind the modal. */
export function WalletSheet({ visible, onClose, need }: { visible: boolean; onClose: () => void; need?: number }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Wallet" icon={<Coins size={20} color={T.amber} />}>
      {visible ? <WalletView need={need} /> : null}
    </Sheet>
  );
}
