import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  INTENTION_LABELS,
  demoDiscoverProfiles,
  fetchDiscoverDeck,
  sendLike,
  type DiscoverProfile,
} from '@/lib/profile';

const { width: SCREEN_W } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_W * 0.28;

export default function DiscoverScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingLive, setUsingLive] = useState(false);
  const [deck, setDeck] = useState<DiscoverProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [matchCard, setMatchCard] = useState<DiscoverProfile | null>(null);

  const position = useRef(new Animated.ValueXY()).current;
  const advancing = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const loadDeck = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const live = await fetchDiscoverDeck(user.id);
      if (live.length > 0) {
        setDeck(live);
        setUsingLive(true);
      } else {
        setDeck(demoDiscoverProfiles());
        setUsingLive(false);
      }
      position.setValue({ x: 0, y: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load discovery';
      setError(msg);
      setDeck(demoDiscoverProfiles());
      setUsingLive(false);
    } finally {
      setLoading(false);
    }
  }, [user?.id, position]);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const current = deck[0] ?? null;
  const nextCards = deck.slice(1, 3);

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_W / 2, 0, SCREEN_W / 2],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [20, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const passOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, -20],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const advanceCard = useCallback(() => {
    setDeck((d) => d.slice(1));
    position.setValue({ x: 0, y: 0 });
    advancing.current = false;
  }, [position]);

  const flyOff = useCallback(
    (dir: 'like' | 'pass', onDone: () => void) => {
      const toX = dir === 'like' ? SCREEN_W * 1.4 : -SCREEN_W * 1.4;
      Animated.timing(position, {
        toValue: { x: toX, y: 0 },
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        onDone();
        advanceCard();
      });
    },
    [advanceCard, position]
  );

  const handlePass = useCallback(() => {
    if (!current || busy || advancing.current) return;
    advancing.current = true;
    flyOff('pass', () => {
      /* pass is local-only — no passes table in schema */
    });
  }, [busy, current, flyOff]);

  const handleLike = useCallback(async () => {
    if (!current || !user?.id || busy || advancing.current) return;
    advancing.current = true;
    setBusy(true);

    const card = current;

    if (!card.isLive) {
      setBusy(false);
      flyOff('like', () => {
        showToast(`Demo like to ${card.name} (not saved)`);
      });
      return;
    }

    try {
      const { match } = await sendLike(user.id, card.id);
      setBusy(false);
      flyOff('like', () => {
        if (match) {
          setMatchCard(card);
        } else {
          showToast(`Like sent to ${card.name}`);
        }
      });
    } catch (err) {
      setBusy(false);
      advancing.current = false;
      position.setValue({ x: 0, y: 0 });
      showToast(err instanceof Error ? err.message : 'Could not send like');
    }
  }, [busy, current, flyOff, position, showToast, user?.id]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 8 && !busy && !advancing.current,
        onPanResponderMove: (_, g) => {
          position.setValue({ x: g.dx, y: g.dy * 0.15 });
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > SWIPE_THRESHOLD) {
            handleLike();
          } else if (g.dx < -SWIPE_THRESHOLD) {
            handlePass();
          } else {
            Animated.spring(position, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [busy, handleLike, handlePass, position]
  );

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color="#E11D48" />
        <Text style={styles.muted}>Loading discovery…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.badge}>
        {usingLive
          ? 'LIVE · profiles from Supabase'
          : 'DEMO · no discoverable profiles yet (likes on demo cards are not saved)'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.deckArea}>
        {!current ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>You're caught up</Text>
            <Text style={styles.muted}>No more profiles in the deck right now.</Text>
            <Pressable style={styles.refreshBtn} onPress={loadDeck}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {nextCards
              .slice()
              .reverse()
              .map((card, idx, arr) => {
                const depth = arr.length - idx;
                return (
                  <View
                    key={card.id}
                    style={[
                      styles.card,
                      {
                        transform: [{ scale: 1 - depth * 0.04 }, { translateY: depth * 8 }],
                        opacity: 0.85,
                      },
                    ]}
                    pointerEvents="none">
                    <CardBody card={card} />
                  </View>
                );
              })}

            <Animated.View
              style={[
                styles.card,
                {
                  transform: [
                    { translateX: position.x },
                    { translateY: position.y },
                    { rotate },
                  ],
                },
              ]}
              {...panResponder.panHandlers}>
              <CardBody card={current} />
              <Animated.View style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]}>
                <Text style={styles.likeStampText}>LIKE</Text>
              </Animated.View>
              <Animated.View style={[styles.stamp, styles.passStamp, { opacity: passOpacity }]}>
                <Text style={styles.passStampText}>PASS</Text>
              </Animated.View>
            </Animated.View>
          </>
        )}
      </View>

      {current ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, styles.passBtn]}
            onPress={handlePass}
            disabled={busy}>
            <Text style={styles.actionLabel}>✕</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.likeBtn]}
            onPress={handleLike}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionLabel}>♥</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <Modal visible={!!matchCard} transparent animationType="fade">
        <View style={styles.matchOverlay}>
          <Text style={styles.matchTitle}>It's a match!</Text>
          <Text style={styles.matchName}>{matchCard?.name}</Text>
          {matchCard?.photoUrl ? (
            <Image source={{ uri: matchCard.photoUrl }} style={styles.matchPhoto} />
          ) : (
            <View style={[styles.matchPhoto, styles.photoFallback]}>
              <Text style={styles.fallbackInitial}>
                {(matchCard?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.matchBody}>
            Mutual like confirmed by the database trigger — you didn't invent this client-side.
          </Text>
          <Pressable style={styles.refreshBtn} onPress={() => setMatchCard(null)}>
            <Text style={styles.refreshText}>Keep swiping</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function CardBody({ card }: { card: DiscoverProfile }) {
  const intention =
    (card.intention && INTENTION_LABELS[card.intention]) || card.intention || null;

  return (
    <View style={styles.cardInner}>
      {card.photoUrl ? (
        <Image source={{ uri: card.photoUrl }} style={styles.photo} />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Text style={styles.fallbackInitial}>{card.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.gradient} />
      <View style={styles.cardMeta}>
        <Text style={styles.cardName}>
          {card.name}
          {card.age != null ? `, ${card.age}` : ''}
          {card.verified ? ' ✓' : ''}
        </Text>
        {card.city ? <Text style={styles.cardCity}>{card.city}</Text> : null}
        {intention ? <Text style={styles.cardIntention}>{intention}</Text> : null}
        {card.bio ? (
          <Text style={styles.cardBio} numberOfLines={3}>
            {card.bio}
          </Text>
        ) : null}
        {!card.isLive ? <Text style={styles.demoTag}>DEMO</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B0F', paddingTop: 16, paddingHorizontal: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { color: '#F4F4F5', fontSize: 28, fontWeight: '800' },
  badge: { color: '#9CA3AF', fontSize: 12, marginTop: 4, marginBottom: 8 },
  muted: { color: '#9CA3AF', marginTop: 8, textAlign: 'center' },
  error: { color: '#FB7185', marginBottom: 8, fontSize: 13 },
  deckArea: { flex: 1, marginTop: 8, marginBottom: 12 },
  card: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  cardInner: { flex: 1 },
  photo: { width: '100%', height: '70%', backgroundColor: '#27272A' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackInitial: { color: '#E11D48', fontSize: 64, fontWeight: '800' },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
    backgroundColor: 'rgba(11,11,15,0.92)',
  },
  cardMeta: { position: 'absolute', left: 16, right: 16, bottom: 18 },
  cardName: { color: '#F4F4F5', fontSize: 26, fontWeight: '800' },
  cardCity: { color: '#D4D4D8', marginTop: 2 },
  cardIntention: { color: '#E11D48', marginTop: 4, fontWeight: '600', fontSize: 13 },
  cardBio: { color: '#A1A1AA', marginTop: 8, lineHeight: 20 },
  demoTag: {
    marginTop: 10,
    alignSelf: 'flex-start',
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: '#FBBF24',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  stamp: {
    position: 'absolute',
    top: 28,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 3,
    borderRadius: 10,
  },
  likeStamp: { left: 18, borderColor: '#34D399', transform: [{ rotate: '-12deg' }] },
  passStamp: { right: 18, borderColor: '#A1A1AA', transform: [{ rotate: '12deg' }] },
  likeStampText: { color: '#34D399', fontWeight: '900', fontSize: 22 },
  passStampText: { color: '#A1A1AA', fontWeight: '900', fontSize: 22 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
    paddingBottom: 24,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passBtn: { backgroundColor: '#27272A', borderWidth: 1, borderColor: '#3F3F46' },
  likeBtn: { backgroundColor: '#E11D48' },
  actionLabel: { color: '#fff', fontSize: 26, fontWeight: '700' },
  empty: {
    flex: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#3F3F46',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: { color: '#F4F4F5', fontSize: 20, fontWeight: '700' },
  refreshBtn: {
    marginTop: 16,
    backgroundColor: '#E11D48',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  refreshText: { color: '#fff', fontWeight: '700' },
  toast: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: { color: '#F4F4F5', fontWeight: '600' },
  matchOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11,11,15,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  matchTitle: { color: '#E11D48', fontSize: 32, fontWeight: '900', marginBottom: 8 },
  matchName: { color: '#F4F4F5', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  matchPhoto: { width: 160, height: 160, borderRadius: 80, marginBottom: 16 },
  matchBody: { color: '#A1A1AA', textAlign: 'center', marginBottom: 8, lineHeight: 20 },
});
