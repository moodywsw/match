import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { MatchOverlay, type MatchOverlayData } from '@/components/app/MatchOverlay';
import { NotificationsPanel, PremiumModal, type NotifItem } from '@/components/app/Overlays';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { ensureConversation } from '@/lib/chat';
import { personFromDiscover, type Me } from '@/lib/compat';
import { fetchInterestLabelsForUsers } from '@/lib/interests';
import { DEMO_MATCHED_IDS, PROFILES, SHOW_DEMO_CONTENT, type Person } from '@/lib/mock';
import { ageFromBirthDate, fetchDiscoverDeck, fetchPrimaryPhotos, sendLike } from '@/lib/profile';
import { fetchInbox, inboxIcon, inboxText, markAllRead, subscribeInbox, timeAgo, type InboxItem } from '@/lib/inbox';
import { pushLatestNotification } from '@/lib/push';

type MatchState = { data: MatchOverlayData; person: Person; matchId: string | null };

type AppContextValue = {
  /** Signed-in user's display data. */
  me: { id: string; name: string; age: number | null; photo: string | null; interests: string[] } | null;
  refreshMe: () => Promise<void>;
  /** Real discoverable people (+ prototype demo people while SHOW_DEMO_CONTENT). */
  people: Person[];
  peopleLoading: boolean;
  peopleError: string | null;
  reloadPeople: () => Promise<void>;
  personById: (id: string) => Person | undefined;
  likedIds: Set<string>;
  passedIds: Set<string>;
  demoMatchedIds: string[];
  like: (p: Person, opts?: { superLike?: boolean }) => Promise<void>;
  pass: (p: Person) => void;
  removePerson: (id: string) => void;
  /** Prototype 'Refresh deck': forget passes (and demo likes) this session. */
  resetDeck: () => void;
  toast: (msg: string) => void;
  openNotifications: () => void;
  openPremium: () => void;
  /** Real notifications (DB triggers) + unread badge count. */
  inbox: InboxItem[];
  unreadCount: number;
};

const Ctx = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [myPhoto, setMyPhoto] = useState<string | null>(null);
  const [myInterests, setMyInterests] = useState<string[]>([]);
  const [realPeople, setRealPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [passedIds, setPassedIds] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [demoMatchedIds, setDemoMatchedIds] = useState<string[]>(DEMO_MATCHED_IDS);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ready = !!user?.id && !!profile?.onboarding_complete;

  const toast = useCallback(
    (msg: string) => {
      setToastMsg(msg);
      toastAnim.setValue(0);
      Animated.spring(toastAnim, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
    },
    [toastAnim]
  );

  const refreshMe = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [photos, interests] = await Promise.all([
        fetchPrimaryPhotos([user.id]),
        fetchInterestLabelsForUsers([user.id]),
      ]);
      setMyPhoto(photos[user.id] ?? null);
      setMyInterests(interests[user.id] ?? []);
    } catch (err) {
      console.warn('[match] refreshMe failed', err);
    }
  }, [user?.id]);

  const meForCompat: Me | null = useMemo(
    () => (user?.id ? { id: user.id, interests: myInterests, intention: profile?.intention ?? null } : null),
    [user?.id, myInterests, profile?.intention]
  );

  const reloadPeople = useCallback(async () => {
    if (!user?.id || !meForCompat) return;
    setPeopleLoading(true);
    setPeopleError(null);
    try {
      const rows = await fetchDiscoverDeck(user.id);
      setRealPeople(rows.map((r) => personFromDiscover(meForCompat, r)));
    } catch (err) {
      setPeopleError(err instanceof Error ? err.message : 'Failed to load people');
    } finally {
      setPeopleLoading(false);
    }
  }, [user?.id, meForCompat]);

  useEffect(() => {
    if (ready) void refreshMe();
  }, [ready, refreshMe]);

  useEffect(() => {
    if (ready) void reloadPeople();
  }, [ready, reloadPeople]);

  useEffect(() => {
    if (!user?.id) {
      setLikedIds(new Set());
      setPassedIds(new Set());
      setRealPeople([]);
      setMyPhoto(null);
      setMyInterests([]);
    }
  }, [user?.id]);

  const people = useMemo(() => {
    const demo = SHOW_DEMO_CONTENT ? PROFILES : [];
    return [...realPeople, ...demo].filter((p) => !removed.has(p.id));
  }, [realPeople, removed]);

  const personById = useCallback((id: string) => [...realPeople, ...PROFILES].find((p) => p.id === id), [realPeople]);

  const me = useMemo(
    () =>
      user?.id
        ? { id: user.id, name: profile?.name || 'You', age: ageFromBirthDate(profile?.birth_date), photo: myPhoto, interests: myInterests }
        : null,
    [user?.id, profile?.name, profile?.birth_date, myPhoto, myInterests]
  );

  const like = useCallback(
    async (p: Person, opts?: { superLike?: boolean }) => {
      if (!user?.id || likedIds.has(p.id)) return;
      setLikedIds((s) => new Set(s).add(p.id));
      const overlay: MatchOverlayData = { name: p.name, photo: p.photo, myPhoto, myName: profile?.name || 'You' };
      if (!p.real) {
        // Demo people behave like the prototype: ~65% chance it's mutual.
        if (Math.random() > 0.35) {
          setDemoMatchedIds((m) => (m.includes(p.id) ? m : [...m, p.id]));
          setMatch({ data: overlay, person: p, matchId: null });
        } else {
          toast(`Like sent to ${p.name} 💫`);
        }
        return;
      }
      try {
        const { match: row } = await sendLike(user.id, p.id, !!opts?.superLike);
        if (row) {
          setMatch({ data: overlay, person: p, matchId: row.id });
          void pushLatestNotification(p.id);
        } else {
          toast(opts?.superLike ? `Super like sent to ${p.name} ⭐` : `Like sent to ${p.name} 💫`);
        }
      } catch (err) {
        setLikedIds((s) => {
          const n = new Set(s);
          n.delete(p.id);
          return n;
        });
        const msg = err instanceof Error ? err.message : 'Could not send like';
        toast(msg.includes('duplicate') ? `You already liked ${p.name}` : msg);
      }
    },
    [user?.id, likedIds, myPhoto, profile?.name, toast]
  );

  const pass = useCallback((p: Person) => setPassedIds((s) => new Set(s).add(p.id)), []);
  const removePerson = useCallback((id: string) => setRemoved((s) => new Set(s).add(id)), []);
  const resetDeck = useCallback(() => {
    setPassedIds(new Set());
    setLikedIds((s) => new Set([...s].filter((id) => !id.startsWith('demo-'))));
    void reloadPeople();
  }, [reloadPeople]);

  const onMatchMessage = useCallback(async () => {
    const m = match;
    setMatch(null);
    if (!m) return;
    if (!m.matchId) {
      router.push({ pathname: '/chat/[conversationId]', params: { conversationId: m.person.id } });
      return;
    }
    try {
      const convId = await ensureConversation(m.matchId);
      router.push({ pathname: '/chat/[conversationId]', params: { conversationId: convId } });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open chat');
    }
  }, [match, router, toast]);

  /* ---------- notifications inbox (realtime) ---------- */
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  useEffect(() => {
    if (!user?.id) {
      setInbox([]);
      return;
    }
    let alive = true;
    fetchInbox(user.id)
      .then((items) => alive && setInbox(items))
      .catch((e) => console.warn('[match] inbox load failed', e));
    const unsub = subscribeInbox(user.id, (item) => {
      setInbox((prev) => [item, ...prev.filter((x) => x.id !== item.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80));
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [user?.id]);
  const unreadCount = useMemo(() => inbox.filter((n) => !n.readAt).length, [inbox]);

  const closeNotifications = useCallback(() => {
    setNotifOpen(false);
    if (!user?.id || !inbox.some((n) => !n.readAt)) return;
    const now = new Date().toISOString();
    setInbox((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    markAllRead(user.id).catch((e) => console.warn('[match] mark read failed', e));
  }, [user?.id, inbox]);

  const openInboxItem = useCallback(
    async (n: InboxItem) => {
      closeNotifications();
      try {
        if (n.type === 'message' && typeof n.payload.conversation_id === 'string') {
          router.push({ pathname: '/chat/[conversationId]', params: { conversationId: n.payload.conversation_id } });
        } else if (n.type === 'match' && typeof n.payload.match_id === 'string') {
          const convId = await ensureConversation(n.payload.match_id);
          router.push({ pathname: '/chat/[conversationId]', params: { conversationId: convId } });
        } else {
          router.navigate('/(tabs)/social');
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not open');
      }
    },
    [closeNotifications, router, toast]
  );

  const notifItems: NotifItem[] = inbox.map((n) => ({
    id: n.id,
    icon: inboxIcon(n.type),
    text: inboxText(n),
    time: timeAgo(n.createdAt),
    unread: !n.readAt,
    onPress: () => void openInboxItem(n),
  }));

  const value = useMemo<AppContextValue>(
    () => ({
      me,
      refreshMe,
      people,
      peopleLoading,
      peopleError,
      reloadPeople,
      personById,
      likedIds,
      passedIds,
      demoMatchedIds,
      like,
      pass,
      removePerson,
      resetDeck,
      toast,
      openNotifications: () => setNotifOpen(true),
      openPremium: () => setPremiumOpen(true),
      inbox,
      unreadCount,
    }),
    [me, refreshMe, people, peopleLoading, peopleError, reloadPeople, personById, likedIds, passedIds, demoMatchedIds, like, pass, removePerson, resetDeck, toast, inbox, unreadCount]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <MatchOverlay data={match?.data ?? null} onClose={() => setMatch(null)} onMessage={onMatchMessage} />
      <NotificationsPanel visible={notifOpen} onClose={closeNotifications} items={notifItems} demoFallback={SHOW_DEMO_CONTENT} />
      <PremiumModal visible={premiumOpen} onClose={() => setPremiumOpen(false)} toast={toast} />
      {toastMsg ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Animated.View
            style={[
              styles.toast,
              { opacity: toastAnim, transform: [{ scale: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] },
            ]}>
            <Txt size={13}>{toastMsg}</Txt>
          </Animated.View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 110, alignItems: 'center', zIndex: 60 },
  toast: { backgroundColor: T.surface3, borderWidth: 1, borderColor: T.border, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, maxWidth: '90%' },
});
