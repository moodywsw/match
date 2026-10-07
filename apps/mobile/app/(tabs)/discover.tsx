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
  TextInput,
  View,
} from 'react-native';

import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  INTENTION_LABELS,
  demoDiscoverProfiles,
  fetchDiscoverDeck,
  sendLike,
  type DiscoverProfile,
} from '@/lib/profile';
import { REPORT_CATEGORIES, blockUser, reportUser, type ReportCategory } from '@/lib/safety';

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
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>('inappropriate');
  const [reportDetails, setReportDetails] = useState('');
  const [safetyBusy, setSafetyBusy] = useState(false);

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
    flyOff('pass', () => {});
  }, [busy, current, flyOff]);

  const handleLike = useCallback(async () => {
    if (!current || !user?.id || busy || advancing.current) return;
    advancing.current = true;
    setBusy(true);
    const card = current;

    if (!card.isLive) {
      setBusy(false);
      flyOff('like', () => showToast(`Demo like to ${card.name} (not saved)`));
      return;
    }

    try {
      const { match } = await sendLike(user.id, card.id);
      setBusy(false);
      flyOff('like', () => {
        if (match) setMatchCard(card);
        else showToast(`Like sent to ${card.name}`);
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
          if (g.dx > SWIPE_THRESHOLD) handleLike();
          else if (g.dx < -SWIPE_THRESHOLD) handlePass();
          else {
            Animated.spring(position, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [busy, handleLike, handlePass, position]
  );

  async function onBlock() {
    if (!user?.id || !current?.isLive) {
      showToast('Block only works on live profiles');
      return;
    }
    setSafetyBusy(true);
    try {
      await blockUser(user.id, current.id);
      setSafetyOpen(false);
      setDeck((d) => d.filter((c) => c.id !== current.id));
      showToast(`${current.name} blocked`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Block failed');
    } finally {
      setSafetyBusy(false);
    }
  }

  async function onReport() {
    if (!user?.id || !current?.isLive) {
      showToast('Report only works on live profiles');
      return;
    }
    setSafetyBusy(true);
    try {
      await reportUser({
        reporterId: user.id,
        reportedId: current.id,
        category: reportCategory,
        details: reportDetails,
      });
      setSafetyOpen(false);
      setReportDetails('');
      showToast('Report submitted');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Report failed');
    } finally {
      setSafetyBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={T.rose} />
        <Text style={styles.muted}>Loading discovery…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.title}>Discover</Text>
          <Text style={styles.badge}>
            {usingLive
              ? `LIVE · ${deck.length} left · rose/violet Match UI`
              : 'DEMO · no discoverable profiles yet'}
          </Text>
        </View>
        {current?.isLive ? (
          <Pressable style={styles.safetyBtn} onPress={() => setSafetyOpen(true)}>
            <Text style={styles.safetyBtnText}>⋯</Text>
          </Pressable>
        ) : null}
      </View>
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
          <Pressable style={[styles.actionBtn, styles.passBtn]} onPress={handlePass} disabled={busy}>
            <Text style={styles.actionLabel}>✕</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.likeBtn]} onPress={handleLike} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionLabel}>♥</Text>}
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
          <Pressable style={styles.refreshBtn} onPress={() => setMatchCard(null)}>
            <Text style={styles.refreshText}>Keep swiping</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={safetyOpen} transparent animationType="slide">
        <View style={styles.safetyWrap}>
          <View style={styles.safetySheet}>
            <Text style={styles.safetyTitle}>Safety · {current?.name}</Text>
            <Pressable
              style={[styles.safetyAction, safetyBusy && styles.disabled]}
              onPress={onBlock}
              disabled={safetyBusy}>
              <Text style={styles.safetyActionText}>Block</Text>
            </Pressable>
            <Text style={styles.muted}>Report category</Text>
            <View style={styles.chips}>
              {REPORT_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  style={[styles.chip, reportCategory === c && styles.chipOn]}
                  onPress={() => setReportCategory(c)}>
                  <Text style={[styles.chipText, reportCategory === c && styles.chipTextOn]}>
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Optional details"
              placeholderTextColor={T.mutedDim}
              value={reportDetails}
              onChangeText={setReportDetails}
            />
            <Pressable
              style={[styles.safetyAction, styles.reportAction, safetyBusy && styles.disabled]}
              onPress={onReport}
              disabled={safetyBusy}>
              <Text style={styles.safetyActionText}>Submit report</Text>
            </Pressable>
            <Pressable onPress={() => setSafetyOpen(false)}>
              <Text style={[styles.muted, { textAlign: 'center', marginTop: 12 }]}>Close</Text>
            </Pressable>
          </View>
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
        {card.interests?.length ? (
          <View style={styles.interestRow}>
            {card.interests.slice(0, 5).map((label) => (
              <View key={label} style={styles.interestChip}>
                <Text style={styles.interestText}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {card.bio ? (
          <Text style={styles.cardBio} numberOfLines={2}>
            {card.bio}
          </Text>
        ) : null}
        {!card.isLive ? <Text style={styles.demoTag}>DEMO</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg, paddingTop: 16, paddingHorizontal: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: T.text, fontSize: 28, fontWeight: '800' },
  badge: { color: T.muted, fontSize: 12, marginTop: 4, marginBottom: 8 },
  muted: { color: T.muted, marginTop: 8, lineHeight: 20 },
  error: { color: '#FB7185', marginBottom: 8, fontSize: 13 },
  safetyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.surface2,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyBtnText: { color: T.text, fontSize: 18, fontWeight: '800' },
  deckArea: { flex: 1, marginTop: 8, marginBottom: 12 },
  card: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardInner: { flex: 1 },
  photo: { width: '100%', height: '68%', backgroundColor: T.border },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackInitial: { color: T.rose, fontSize: 64, fontWeight: '800' },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '48%',
    backgroundColor: 'rgba(11,11,15,0.94)',
  },
  cardMeta: { position: 'absolute', left: 16, right: 16, bottom: 18 },
  cardName: { color: T.text, fontSize: 26, fontWeight: '800' },
  cardCity: { color: '#D4D4D8', marginTop: 2 },
  cardIntention: { color: T.rose, marginTop: 4, fontWeight: '600', fontSize: 13 },
  interestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  interestChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(139,107,255,0.22)',
    borderWidth: 1,
    borderColor: T.violet,
  },
  interestText: { color: '#E9E3FF', fontSize: 11, fontWeight: '700' },
  cardBio: { color: T.muted, marginTop: 8, lineHeight: 20 },
  demoTag: {
    marginTop: 10,
    alignSelf: 'flex-start',
    color: T.amber,
    fontSize: 11,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: T.amber,
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
  likeStamp: { left: 18, borderColor: T.mint, transform: [{ rotate: '-12deg' }] },
  passStamp: { right: 18, borderColor: T.muted, transform: [{ rotate: '12deg' }] },
  likeStampText: { color: T.mint, fontWeight: '900', fontSize: 22 },
  passStampText: { color: T.muted, fontWeight: '900', fontSize: 22 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingBottom: 24 },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passBtn: { backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border },
  likeBtn: { backgroundColor: T.rose },
  actionLabel: { color: '#fff', fontSize: 26, fontWeight: '700' },
  empty: {
    flex: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.border,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: { color: T.text, fontSize: 20, fontWeight: '700' },
  refreshBtn: {
    marginTop: 16,
    backgroundColor: T.rose,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  refreshText: { color: '#fff', fontWeight: '700' },
  toast: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: { color: T.text, fontWeight: '600' },
  matchOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11,11,15,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  matchTitle: { color: T.rose, fontSize: 32, fontWeight: '900', marginBottom: 8 },
  matchName: { color: T.text, fontSize: 22, fontWeight: '700', marginBottom: 16 },
  matchPhoto: { width: 160, height: 160, borderRadius: 80, marginBottom: 16 },
  safetyWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  safetySheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
  },
  safetyTitle: { color: T.text, fontWeight: '800', fontSize: 18, marginBottom: 4 },
  safetyAction: {
    backgroundColor: T.surface2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.border,
  },
  reportAction: { backgroundColor: T.rose, borderColor: T.rose },
  safetyActionText: { color: '#fff', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: T.surface2,
  },
  chipOn: { borderColor: T.violet, backgroundColor: 'rgba(139,107,255,0.25)' },
  chipText: { color: T.muted, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  input: {
    backgroundColor: T.bg,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    color: T.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  disabled: { opacity: 0.55 },
});
