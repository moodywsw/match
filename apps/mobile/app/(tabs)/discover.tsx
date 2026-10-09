import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Camera, Compass, Heart, MapPin, MoreHorizontal, RotateCcw, Sparkles, SlidersHorizontal, Star, X, Zap } from 'lucide-react-native';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, View } from 'react-native';

import { useBarInsets } from '@/components/app/Bars';
import { BoostCoinsSheet } from '@/components/app/Wallet';
import { CompatibilitySheet, DEFAULT_FILTERS, FiltersSheet, MapView, SafetySheet, type Filters } from '@/components/app/DiscoverParts';
import { DemoTag, FadeUp, MatchRing, Photo, PrimaryButton, RoundBtn, Tag, VerifiedIcon } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { personFromDiscover } from '@/lib/compat';
import { DISCOVERY_MODES, hash01, type Person } from '@/lib/mock';
import { countdownLabel, fetchDailyPicks } from '@/lib/picks';
import { activateBoost, fetchBoostStatus, perkErrorCode, recordProfileView } from '@/lib/perks';
import { blockUser, reportUser } from '@/lib/safety';
import { friendlyError } from '@/lib/errors';

const { width: SCREEN_W } = Dimensions.get('window');
const SWIPE = 110;

function sortForMode(list: Person[], mode: string, myInterests: string[]) {
  const mine = new Set(myInterests.map((s) => s.toLowerCase()));
  const shared = (p: Person) => p.tags.filter((t) => mine.has(t.toLowerCase())).length;
  const arr = [...list];
  switch (mode) {
    case 'Near You':
      return arr.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    case 'Similar Taste':
      return arr.sort((a, b) => shared(b) - shared(a) || b.breakdown.Interests - a.breakdown.Interests);
    case 'Opposites Attract':
      return arr.sort((a, b) => a.breakdown.Interests - b.breakdown.Interests);
    case 'New Users':
      return arr.sort((a, b) => Number(b.real) - Number(a.real) || hash01(a.id, 21) - hash01(b.id, 21));
    case 'Trending':
    case 'Events':
      return arr.sort((a, b) => hash01(a.id, mode.length) - hash01(b.id, mode.length));
    default:
      return arr.sort((a, b) => Number(b.real) - Number(a.real) || b.match - a.match);
  }
}

/** Rewound card first, then people who super liked me, then boosted profiles (stable). */
function pinPriority(list: Person[], rewoundId: string | null) {
  const rank = (p: Person) => (p.id === rewoundId ? 3 : p.superLikedMe ? 2 : p.boosted ? 1 : 0);
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(b.p) - rank(a.p) || a.i - b.i)
    .map((x) => x.p);
}

function useBoost() {
  const { tier, toast } = useApp();
  const [activeUntil, setActiveUntil] = useState<number | null>(null);
  const [left, setLeft] = useState({ used: 0, quota: 0 });
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    try {
      const s = await fetchBoostStatus();
      setActiveUntil(s.activeUntil ? new Date(s.activeUntil).getTime() : null);
      setLeft({ used: s.usedThisMonth, quota: s.monthlyQuota });
    } catch (e) {
      console.warn('[match] boost status failed', e);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, tier]);
  const active = activeUntil != null && activeUntil > now;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const remaining = active ? Math.max(0, Math.round((activeUntil! - now) / 1000)) : 0;
  const label = active ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Boost';
  const [coinSheet, setCoinSheet] = useState(false);
  const start = async () => {
    if (active) {
      toast(`You're boosted — top of Discover for ${Math.ceil(remaining / 60)} more min`);
      return;
    }
    // No MATCH+ boost left this month (or free plan) → offer a boost with coins instead.
    if (left.quota - left.used <= 0) {
      setCoinSheet(true);
      return;
    }
    try {
      const ends = await activateBoost();
      setActiveUntil(new Date(ends).getTime());
      setNow(Date.now());
      toast('⚡ Boost on — 30 min at the top of Discover');
      void refresh();
    } catch (err) {
      const code = perkErrorCode(err);
      if (code === 'boost_quota' || code === 'premium_required') setCoinSheet(true);
      else if (code === 'boost_active') toast('A boost is already running');
      else toast(code);
    }
  };
  const onCoinBoost = (endsAt: string) => {
    setActiveUntil(new Date(endsAt).getTime());
    setNow(Date.now());
    toast('⚡ Boost on — you’re near the top of Discover');
    void refresh();
  };
  return { active, label, start, available: left.quota - left.used, coinSheet, setCoinSheet, onCoinBoost, hasPlanBoost: tier !== 'free' };
}

type PicksState = { loading: boolean; error: string | null; refreshesAt: string | null; quota: number; people: Person[]; actedIds: Set<string> };

/** Today's curated picks (server-generated per local day). */
function usePicks() {
  const { user, profile } = useAuth();
  const { me } = useApp();
  const [st, setSt] = useState<PicksState>({ loading: true, error: null, refreshesAt: null, quota: 0, people: [], actedIds: new Set() });
  const interestsKey = (me?.interests ?? []).join('|');
  const load = useCallback(async () => {
    if (!user?.id) return;
    setSt((s) => ({ ...s, loading: s.people.length === 0, error: null }));
    try {
      const d = await fetchDailyPicks();
      const meC = { id: user.id, interests: interestsKey ? interestsKey.split('|') : [], intention: profile?.intention ?? null };
      setSt({
        loading: false,
        error: null,
        refreshesAt: d.refreshesAt,
        quota: d.quota,
        people: d.picks.map((p) => ({ ...personFromDiscover(meC, p), pickReason: p.reason })),
        actedIds: new Set(d.picks.filter((p) => p.acted).map((p) => p.id)),
      });
    } catch (err) {
      setSt((s) => ({ ...s, loading: false, error: friendlyError(err, "Couldn't load today's picks") }));
    }
  }, [user?.id, profile?.intention, interestsKey]);
  useEffect(() => {
    void load();
  }, [load]);
  return { ...st, reload: load };
}

/** Ticks once a second on its own so the card stack doesn't re-render. */
const Countdown = memo(function Countdown({ to, onDone, size = 12, color = T.amber }: { to: string | null; onDone?: () => void; size?: number; color?: string }) {
  const [now, setNow] = useState(Date.now());
  const done = useRef(false);
  useEffect(() => {
    done.current = false;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  useEffect(() => {
    if (to && !done.current && new Date(to).getTime() <= now) {
      done.current = true;
      onDone?.();
    }
  }, [now, to, onDone]);
  return (
    <Txt v="mono" w={700} size={size} color={color}>
      {countdownLabel(to, now)}
    </Txt>
  );
});

export default function DiscoverTab() {
  const bars = useBarInsets();
  const { user } = useAuth();
  const { people, likedIds, passedIds, like, pass, me, resetDeck, removePerson, toast, tier, setDeckFilters, rewind, rewoundId } = useApp();
  const plus = tier !== 'free';
  const boost = useBoost();
  const router = useRouter();
  const { openPremium } = useApp();
  const [mode, setMode] = useState('Recommended');
  const [view, setView] = useState<'cards' | 'map'>('cards');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<Person | null>(null);
  const [safety, setSafety] = useState<Person | null>(null);
  const [areaH, setAreaH] = useState(480);
  const [exiting, setExiting] = useState<string | null>(null);
  const [tab, setTab] = useState<'picks' | 'explore'>('picks');
  const picks = usePicks();
  const isPicks = tab === 'picks';
  const openPickIds = useMemo(
    () => new Set(picks.people.filter((p) => !picks.actedIds.has(p.id) && !likedIds.has(p.id) && !passedIds.has(p.id)).map((p) => p.id)),
    [picks.people, picks.actedIds, likedIds, passedIds]
  );
  const position = useRef(new Animated.ValueXY()).current;
  const busy = useRef(false);

  const exploreDeck = useMemo(() => {
    const filtered = people.filter(
      (p) =>
        !likedIds.has(p.id) &&
        !passedIds.has(p.id) &&
        p.id !== exiting &&
        (p.distance == null || p.distance <= filters.maxDistance) &&
        (p.age == null || filters.minAge == null || p.age >= filters.minAge) &&
        (p.age == null || filters.maxAge == null || p.age <= filters.maxAge) &&
        (!plus || !filters.verifiedOnly || p.verified) &&
        (!plus || !filters.intention || p.intentionCode === filters.intention) &&
        // today's open picks live in their own tab
        !openPickIds.has(p.id)
    );
    return pinPriority(sortForMode(filtered, mode, me?.interests ?? []), rewoundId);
  }, [people, likedIds, passedIds, exiting, filters, mode, me?.interests, plus, rewoundId, openPickIds]);
  const picksDeck = useMemo(
    () => pinPriority(picks.people.filter((p) => (openPickIds.has(p.id) || p.id === rewoundId) && p.id !== exiting && !likedIds.has(p.id) && !passedIds.has(p.id)), rewoundId),
    [picks.people, openPickIds, rewoundId, exiting, likedIds, passedIds]
  );
  const deck = isPicks ? picksDeck : exploreDeck;
  const picksLeft = picksDeck.length;

  const openDetail = useCallback((p: Person) => {
    setDetail(p);
    if (p.real) recordProfileView(p.id).catch((e) => console.warn('[match] record_profile_view failed', e));
  }, []);
  const openSafety = useCallback((p: Person) => setSafety(p), []);

  const doRewind = async () => {
    if (busy.current) return;
    const id = await rewind();
    if (id) setExiting(null);
    if (id && picks.people.some((p) => p.id === id)) void picks.reload();
  };

  const current = deck[0] ?? null;

  // Reset the drag position only once the next card is on top (avoids a flash).
  useLayoutEffect(() => {
    position.setValue({ x: 0, y: 0 });
    busy.current = false;
  }, [current?.id, position]);

  const advance = (dir: 'like' | 'pass' | 'super') => {
    const card = current;
    if (!card || busy.current) return;
    busy.current = true;
    Animated.timing(position, { toValue: { x: dir === 'pass' ? -SCREEN_W * 1.4 : SCREEN_W * 1.4, y: 0 }, duration: 220, useNativeDriver: true }).start(() => {
      setExiting(card.id);
      if (dir === 'pass') pass(card);
      // If the like fails (e.g. daily limit) the card must come back instead of staying hidden.
      else void Promise.resolve(like(card, { superLike: dir === 'super' })).finally(() => setExiting((e) => (e === card.id ? null : e)));
    });
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) && !busy.current,
        onPanResponderMove: (_, g) => position.setValue({ x: g.dx, y: g.dy * 0.15 }),
        onPanResponderRelease: (_, g) => {
          if (g.dx > SWIPE) advanceRef.current('like');
          else if (g.dx < -SWIPE) advanceRef.current('pass');
          else Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(),
      }),
    [position]
  );

  const { rotate, likeOpacity, passOpacity } = useMemo(
    () => ({
      rotate: position.x.interpolate({ inputRange: [-180, 0, 180], outputRange: ['-10deg', '0deg', '10deg'] }),
      likeOpacity: position.x.interpolate({ inputRange: [40, 41, 120], outputRange: [0, 0.6, 1], extrapolate: 'clamp' }),
      passOpacity: position.x.interpolate({ inputRange: [-120, -41, -40], outputRange: [1, 0.6, 0], extrapolate: 'clamp' }),
    }),
    [position]
  );

  // Small phones: let the card shrink with the available area instead of overflowing the buttons.
  const cardH = Math.max(260, areaH - 6 - 12);

  return (
    <View style={{ flex: 1, paddingTop: bars.top + 14, paddingBottom: bars.bottom + 12 }}>
      <FadeUp style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 4, backgroundColor: T.surface2, borderRadius: 999, padding: 4, marginHorizontal: 18, marginBottom: 10 }}>
          {(
            [
              ['picks', "Today's picks"],
              ['explore', 'Explore more'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 999, backgroundColor: tab === key ? T.surface : 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {key === 'picks' ? <Sparkles size={13} color={tab === key ? T.amber : T.muted} /> : <Compass size={13} color={tab === key ? T.text : T.muted} />}
              <Txt w={700} size={12.5} color={tab === key ? T.text : T.muted}>
                {label}
              </Txt>
              {key === 'picks' && picksLeft > 0 ? (
                <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: T.rose, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt w={800} size={10} color="#fff">
                    {picksLeft}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        {isPicks ? (
          <View style={{ marginHorizontal: 18, marginBottom: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Txt size={12} color={T.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
                {picks.quota ? `${picksLeft} of ${picks.quota} left · chosen for you` : 'Chosen for you every day'}
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Txt size={11} color={T.mutedDim}>
                  New in
                </Txt>
                <Countdown to={picks.refreshesAt} onDone={picks.reload} />
              </View>
            </View>
            {!plus && picksLeft > 0 ? (
              <Txt size={11} color={T.mutedDim} style={{ marginTop: 2 }}>
                Likes on picks don't use your daily likes
              </Txt>
            ) : null}
          </View>
        ) : (
        <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18, paddingBottom: 10 }}>
          {DISCOVERY_MODES.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: mode === m ? T.rose : T.border, backgroundColor: mode === m ? `${T.rose}22` : T.surface2 }}>
              <Txt w={600} size={12.5} color={mode === m ? '#fff' : T.muted}>
                {m}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 18, marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', gap: 4, backgroundColor: T.surface2, borderRadius: 999, padding: 4 }}>
          {(
            [
              ['cards', 'Cards'],
              ['map', 'Map'],
            ] as const
          ).map(([key, label]) => (
            <Pressable key={key} onPress={() => setView(key)} style={{ paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, backgroundColor: view === key ? T.surface : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {key === 'map' ? <MapPin size={13} color={view === key ? T.text : T.muted} /> : <Sparkles size={13} color={view === key ? T.text : T.muted} />}
              <Txt w={700} size={12.5} color={view === key ? T.text : T.muted}>
                {label}
              </Txt>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => void boost.start()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: boost.active ? T.amber : T.border, backgroundColor: boost.active ? `${T.amber}22` : T.surface2 }}>
          <Zap size={13} color={T.amber} fill={boost.active ? T.amber : 'transparent'} />
          <Txt v={boost.active ? 'mono' : undefined} w={700} size={12.5} color={boost.active ? T.amber : T.muted}>
            {boost.label}
          </Txt>
        </Pressable>
        </View>
        </>
        )}

        {!isPicks && view === 'map' ? (
          <View style={{ flex: 1, paddingHorizontal: 18 }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
            <MapView profiles={people.filter((p) => !likedIds.has(p.id))} onLike={(p) => like(p)} height={Math.max(300, areaH - 80)} />
          </View>
        ) : (
          <>
            <View style={{ flex: 1, marginTop: 6, marginHorizontal: 18 }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
              {!current && isPicks ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 24, gap: 10, paddingHorizontal: 24 }}>
                  <Sparkles size={26} color={T.amber} />
                  {picks.loading ? (
                    <Txt color={T.muted}>Finding today's picks…</Txt>
                  ) : picks.error ? (
                    <>
                      <Txt color={T.muted} center>
                        {picks.error}
                      </Txt>
                      <PrimaryButton small label="Try again" onPress={() => void picks.reload()} />
                    </>
                  ) : (
                    <>
                      <Txt v="display" size={18} center>
                        {picks.people.length ? "You're all caught up" : 'No picks right now'}
                      </Txt>
                      <Txt size={12.5} color={T.muted} center>
                        {picks.people.length ? 'Fresh picks arrive every day.' : "We'll look again within the hour."}
                      </Txt>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Txt size={12} color={T.mutedDim}>
                          New picks in
                        </Txt>
                        <Countdown to={picks.refreshesAt} onDone={picks.reload} size={13} />
                      </View>
                      <PrimaryButton small label="Explore more" onPress={() => setTab('explore')} />
                    </>
                  )}
                </View>
              ) : !current ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 24, gap: 10 }}>
                  <RotateCcw size={26} color={T.muted} />
                  <Txt color={T.muted}>You've seen everyone for now.</Txt>
                  <PrimaryButton small label="Refresh deck" onPress={resetDeck} />
                  <Pressable onPress={() => void doRewind()} hitSlop={8} style={{ marginTop: 4 }}>
                    <Txt w={700} size={12} color={T.amber}>
                      ↺ Undo last swipe{plus ? '' : ' (MATCH+)'}
                    </Txt>
                  </Pressable>
                </View>
              ) : (
                deck
                  .slice(0, 3)
                  .reverse()
                  .map((p, idx, arr) => {
                    const isTop = idx === arr.length - 1;
                    const stackOffset = (arr.length - 1 - idx) * 6;
                    return (
                      <Animated.View
                        key={p.id}
                        {...(isTop ? pan.panHandlers : {})}
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: stackOffset,
                          height: cardH,
                          borderRadius: 26,
                          borderWidth: p.superLikedMe ? 2 : 1,
                          borderColor: p.superLikedMe ? T.amber : T.border,
                          backgroundColor: T.surface,
                          shadowColor: '#000',
                          shadowOpacity: 0.55,
                          shadowRadius: 20,
                          shadowOffset: { width: 0, height: 18 },
                          transform: isTop
                            ? [{ translateX: position.x }, { translateY: position.y }, { rotate }]
                            : [{ scale: 1 - stackOffset / 120 }],
                        }}>
                        <Card
                          p={p}
                          isTop={isTop}
                          likeOpacity={likeOpacity}
                          passOpacity={passOpacity}
                          onWhy={openDetail}
                          onSafety={openSafety}
                        />
                      </Animated.View>
                    );
                  })
              )}
            </View>

            {current ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 14 }}>
                <RoundBtn onPress={() => void doRewind()} color={T.amber} small>
                  <RotateCcw size={16} color={T.amber} />
                </RoundBtn>
                <RoundBtn onPress={() => advance('pass')} color={T.mutedDim}>
                  <X size={24} color={T.mutedDim} />
                </RoundBtn>
                {isPicks ? null : (
                  <RoundBtn onPress={() => setShowFilters(true)} color={T.violet} small>
                    <SlidersHorizontal size={16} color={T.violet} />
                  </RoundBtn>
                )}
                <RoundBtn onPress={() => advance('like')} color={T.rose} big>
                  <Heart size={26} color={T.rose} fill={T.rose} />
                </RoundBtn>
                <RoundBtn onPress={() => advance('super')} color={T.amber} small>
                  <Star size={16} color={T.amber} fill={T.amber} />
                </RoundBtn>
              </View>
            ) : null}
          </>
        )}
      </FadeUp>

      <CompatibilitySheet profile={detail} onClose={() => setDetail(null)} />
      <BoostCoinsSheet
        visible={boost.coinSheet}
        onClose={() => boost.setCoinSheet(false)}
        onBoosted={boost.onCoinBoost}
        hasPlanBoost={boost.hasPlanBoost}
        onPremium={() => {
          boost.setCoinSheet(false);
          openPremium();
        }}
        onTopUp={(need) => {
          boost.setCoinSheet(false);
          router.push({ pathname: '/wallet', params: { need: String(need) } });
        }}
      />
      <FiltersSheet
        visible={showFilters}
        filters={filters}
        onClose={() => setShowFilters(false)}
        onApply={(f) => {
          setFilters(f);
          setShowFilters(false);
          setDeckFilters({
            maxKm: f.maxDistance,
            minAge: f.minAge,
            maxAge: f.maxAge,
            verifiedOnly: plus && f.verifiedOnly,
            intention: plus ? f.intention : null,
          });
        }}
      />
      <SafetySheet
        person={safety}
        onClose={() => setSafety(null)}
        onBlock={async () => {
          if (!user?.id || !safety) return;
          try {
            await blockUser(user.id, safety.id);
            removePerson(safety.id);
            toast(`${safety.name} blocked`);
            setSafety(null);
          } catch (err) {
            toast(friendlyError(err, 'Block failed — try again'));
          }
        }}
        onReport={async (category, details) => {
          if (!user?.id || !safety) return;
          try {
            await reportUser({ reporterId: user.id, reportedId: safety.id, category, details });
            toast('Report submitted — thank you');
            setSafety(null);
          } catch (err) {
            toast(friendlyError(err, 'Report failed — try again'));
          }
        }}
      />
    </View>
  );
}

const Card = memo(function Card({
  p,
  isTop,
  likeOpacity,
  passOpacity,
  onWhy,
  onSafety,
}: {
  p: Person;
  isTop: boolean;
  likeOpacity: Animated.AnimatedInterpolation<number>;
  passOpacity: Animated.AnimatedInterpolation<number>;
  onWhy: (p: Person) => void;
  onSafety: (p: Person) => void;
}) {
  return (
    <View style={{ flex: 1, borderRadius: 26, overflow: 'hidden' }}>
      <View style={{ height: '72%' }}>
        <Photo uri={p.photo} name={p.name} style={{ width: '100%', height: '100%' }} />
        <LinearGradient colors={['transparent', 'rgba(15,12,20,0.9)']} locations={[0.55, 1]} style={{ position: 'absolute', inset: 0 }} />
        {isTop ? (
          <>
            <Animated.View style={{ position: 'absolute', top: 24, left: 20, borderWidth: 3, borderColor: T.mint, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 10, transform: [{ rotate: '-12deg' }], opacity: likeOpacity }}>
              <Txt w={800} size={20} color={T.mint}>
                LIKE
              </Txt>
            </Animated.View>
            <Animated.View style={{ position: 'absolute', top: 24, right: 20, borderWidth: 3, borderColor: T.mutedDim, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 10, transform: [{ rotate: '12deg' }], opacity: passOpacity }}>
              <Txt w={800} size={20} color={T.mutedDim}>
                PASS
              </Txt>
            </Animated.View>
          </>
        ) : null}
        <View style={{ position: 'absolute', top: 14, right: 14 }}>
          <MatchRing percent={p.match} size={54} />
        </View>
        <View style={{ position: 'absolute', top: 14, left: 14 }}>
          {p.real ? (
            <Pressable onPress={() => onSafety(p)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.chipDark, alignItems: 'center', justifyContent: 'center' }}>
              <MoreHorizontal size={16} color={T.text} />
            </Pressable>
          ) : (
            <DemoTag />
          )}
        </View>
        <View style={{ position: 'absolute', bottom: 14, left: 16, right: 16 }}>
          {p.pickReason ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: T.chipDark, borderWidth: 1, borderColor: `${T.amber}66`, marginBottom: 6 }}>
              <Sparkles size={11} color={T.amber} />
              <Txt w={700} size={11} color={T.amber} numberOfLines={1} style={{ flexShrink: 1 }}>
                {p.pickReason}
              </Txt>
            </View>
          ) : null}
          {p.superLikedMe || p.boosted ? (
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
              {p.superLikedMe ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: T.amber }}>
                  <Star size={11} color={T.ink} fill={T.ink} />
                  <Txt w={800} size={11} color={T.ink}>
                    Super liked you
                  </Txt>
                </View>
              ) : null}
              {p.boosted ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: T.chipDark, borderWidth: 1, borderColor: `${T.amber}88` }}>
                  <Zap size={11} color={T.amber} fill={T.amber} />
                  <Txt w={700} size={11} color={T.amber}>
                    Boosted
                  </Txt>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt v="display" size={24}>
              {p.name}
              {p.age ? `, ${p.age}` : ''}
            </Txt>
            {p.verified ? <VerifiedIcon /> : null}
          </View>
          {p.realPhotos ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Camera size={11} color={T.mint} />
              <Txt w={700} size={11} color={T.mint}>
                Real photos · verified by dates
              </Txt>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <MapPin size={12} color="#E4DAF2" />
            <Txt size={12.5} color="#E4DAF2">
              {[p.city, p.distance != null ? `${p.distance} km away` : null].filter(Boolean).join(' · ') || 'Nearby'}
            </Txt>
          </View>
        </View>
      </View>
      <View style={{ paddingVertical: 12, paddingHorizontal: 16, flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {p.tags.slice(0, 5).map((t) => (
            <Tag key={t} label={t} />
          ))}
        </View>
        {p.bio ? (
          <Txt size={12.5} color={T.muted} lh={1.4} numberOfLines={2}>
            "{p.bio}"
          </Txt>
        ) : null}
        {isTop ? (
          <Pressable onPress={() => onWhy(p)} hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Txt w={700} size={11.5} color={T.rose}>
              Why you match →
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});
