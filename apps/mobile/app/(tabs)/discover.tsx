import { LinearGradient } from 'expo-linear-gradient';
import { Heart, MapPin, MoreHorizontal, RotateCcw, Sparkles, SlidersHorizontal, Star, X } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, View } from 'react-native';

import { useBarInsets } from '@/components/app/Bars';
import { CompatibilitySheet, FiltersSheet, MapView, SafetySheet, type Filters } from '@/components/app/DiscoverParts';
import { DemoTag, FadeUp, MatchRing, Photo, PrimaryButton, RoundBtn, Tag, VerifiedIcon } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useEvents } from '@/hooks/useEvents';
import { DISCOVERY_MODES, hash01, type Person } from '@/lib/mock';
import { blockUser, reportUser } from '@/lib/safety';

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

export default function DiscoverTab() {
  const bars = useBarInsets();
  const { user } = useAuth();
  const { people, likedIds, passedIds, like, pass, me, resetDeck, removePerson, toast } = useApp();
  const { events } = useEvents();
  const [mode, setMode] = useState('Recommended');
  const [view, setView] = useState<'cards' | 'map'>('cards');
  const [filters, setFilters] = useState<Filters>({ maxDistance: 15, verifiedOnly: false, intention: null });
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<Person | null>(null);
  const [safety, setSafety] = useState<Person | null>(null);
  const [areaH, setAreaH] = useState(480);
  const [exiting, setExiting] = useState<string | null>(null);
  const position = useRef(new Animated.ValueXY()).current;
  const busy = useRef(false);

  const deck = useMemo(() => {
    const filtered = people.filter(
      (p) =>
        !likedIds.has(p.id) &&
        !passedIds.has(p.id) &&
        p.id !== exiting &&
        (p.distance == null || p.distance <= filters.maxDistance) &&
        (!filters.verifiedOnly || p.verified) &&
        (!filters.intention || p.intentionCode === filters.intention)
    );
    return sortForMode(filtered, mode, me?.interests ?? []);
  }, [people, likedIds, passedIds, exiting, filters, mode, me?.interests]);

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
      else void like(card, { superLike: dir === 'super' });
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

  const rotate = position.x.interpolate({ inputRange: [-180, 0, 180], outputRange: ['-10deg', '0deg', '10deg'] });
  const likeOpacity = position.x.interpolate({ inputRange: [40, 41, 120], outputRange: [0, 0.6, 1], extrapolate: 'clamp' });
  const passOpacity = position.x.interpolate({ inputRange: [-120, -41, -40], outputRange: [1, 0.6, 0], extrapolate: 'clamp' });

  const cardH = Math.max(360, areaH - 6 - 12);

  return (
    <View style={{ flex: 1, paddingTop: bars.top + 14, paddingBottom: bars.bottom + 12 }}>
      <FadeUp style={{ flex: 1 }}>
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

        <View style={{ flexDirection: 'row', gap: 4, backgroundColor: T.surface2, borderRadius: 999, padding: 4, marginBottom: 4, alignSelf: 'flex-start', marginLeft: 18 }}>
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

        {view === 'map' ? (
          <View style={{ flex: 1, paddingHorizontal: 18 }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
            <MapView profiles={people.filter((p) => !likedIds.has(p.id))} events={events} onLike={(p) => like(p)} height={Math.max(300, areaH - 80)} />
          </View>
        ) : (
          <>
            <View style={{ flex: 1, marginTop: 6, marginHorizontal: 18 }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
              {!current ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 24, gap: 10 }}>
                  <RotateCcw size={26} color={T.muted} />
                  <Txt color={T.muted}>You've seen everyone for now.</Txt>
                  <PrimaryButton small label="Refresh deck" onPress={resetDeck} />
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
                          borderWidth: 1,
                          borderColor: T.border,
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
                          onWhy={() => setDetail(p)}
                          onSafety={() => setSafety(p)}
                        />
                      </Animated.View>
                    );
                  })
              )}
            </View>

            {current ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, marginTop: 14 }}>
                <RoundBtn onPress={() => advance('pass')} color={T.mutedDim}>
                  <X size={24} color={T.mutedDim} />
                </RoundBtn>
                <RoundBtn onPress={() => setShowFilters(true)} color={T.violet} small>
                  <SlidersHorizontal size={16} color={T.violet} />
                </RoundBtn>
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
      <FiltersSheet
        visible={showFilters}
        filters={filters}
        onClose={() => setShowFilters(false)}
        onApply={(f) => {
          setFilters(f);
          setShowFilters(false);
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
            toast(err instanceof Error ? err.message : 'Block failed');
          }
        }}
        onReport={async (category, details) => {
          if (!user?.id || !safety) return;
          try {
            await reportUser({ reporterId: user.id, reportedId: safety.id, category, details });
            toast('Report submitted — thank you');
            setSafety(null);
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Report failed');
          }
        }}
      />
    </View>
  );
}

function Card({
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
  onWhy: () => void;
  onSafety: () => void;
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
            <Pressable onPress={onSafety} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.chipDark, alignItems: 'center', justifyContent: 'center' }}>
              <MoreHorizontal size={16} color={T.text} />
            </Pressable>
          ) : (
            <DemoTag />
          )}
        </View>
        <View style={{ position: 'absolute', bottom: 14, left: 16, right: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt v="display" size={24}>
              {p.name}
              {p.age ? `, ${p.age}` : ''}
            </Txt>
            {p.verified ? <VerifiedIcon /> : null}
          </View>
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
          <Pressable onPress={onWhy} hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Txt w={700} size={11.5} color={T.rose}>
              Why you match →
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
