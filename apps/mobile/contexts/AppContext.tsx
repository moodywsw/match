import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { MatchOverlay, type MatchOverlayData } from '@/components/app/MatchOverlay';
import { NotificationsPanel, PremiumModal, type NotifItem } from '@/components/app/Overlays';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { ensureConversation } from '@/lib/chat';
import { openNotificationTarget } from '@/lib/deeplinks';
import { subscribePushTaps, type PushTap } from '@/lib/notifications';
import { personFromDiscover, type Me } from '@/lib/compat';
import { fetchInterestLabelsForUsers } from '@/lib/interests';
import { DEMO_MATCHED_IDS, PROFILES, SHOW_DEMO_CONTENT, type Person } from '@/lib/mock';
import { ageFromBirthDate, fetchDiscoverDeck, fetchPrimaryPhotos, recordPass, sendLike, type DeckFilters } from '@/lib/profile';
import { perkErrorCode, rewindLastSwipe } from '@/lib/perks';
import { fetchInbox, inboxIcon, inboxText, markAllRead, markRead, subscribeInbox, timeAgo, type InboxItem } from '@/lib/inbox';
import { configureIap, fetchServerTier, type EntitlementId, type Tier } from '@/lib/iap';
import { pushLatestNotification } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';

type MatchState = { data: MatchOverlayData; person: Person; matchId: string | null };

type AppContextValue = {
  /** Signed-in user's display data. */
  me: { id: string; name: string; age: number | null; photo: string | null; interests: string[] } | null;
  refreshMe: () => Promise<void>;
  /** Real discoverable people (+ prototype demo people while SHOW_DEMO_CONTENT). */
  people: Person[];
  peopleLoading: boolean;
  peopleError: string | null;
  reloadPeople: (opts?: { includePassed?: boolean }) => Promise<void>;
  /** Server-side deck filters (age/distance for all; verified/intention honoured for MATCH+). */
  deckFilters: DeckFilters;
  setDeckFilters: (f: DeckFilters) => void;
  personById: (id: string) => Person | undefined;
  likedIds: Set<string>;
  passedIds: Set<string>;
  demoMatchedIds: string[];
  like: (p: Person, opts?: { superLike?: boolean }) => Promise<void>;
  pass: (p: Person) => void;
  removePerson: (id: string) => void;
  /** Prototype 'Refresh deck': bring passed people back (server include_passed). */
  resetDeck: () => void;
  /** MATCH+: undo the last like/pass (server RPC, only if no match formed). Returns the person id put back on top. */
  rewind: () => Promise<string | null>;
  /** Person just restored by rewind — Discover shows it first. */
  rewoundId: string | null;
  toast: (msg: string) => void;
  openNotifications: () => void;
  openPremium: () => void;
  /** Real notifications (DB triggers) + unread badge count. */
  inbox: InboxItem[];
  unreadCount: number;
  /** Locally mark a conversation's message notifications read (server already did). */
  clearInboxFor: (conversationId: string) => void;
  /** Server-side entitlement (public.subscriptions via get_my_tier). */
  tier: Tier;
  refreshTier: () => Promise<Tier>;
  /** True when entitled; otherwise opens the paywall (with a reason toast) and returns false. */
  requirePremium: (min: EntitlementId, reason?: string) => boolean;
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
  const [deckFilters, setDeckFilters] = useState<DeckFilters>({});
  const [rewoundId, setRewoundId] = useState<string | null>(null);
  /** Local swipe history (newest last) so demo cards can be rewound and real ones restored instantly. */
  const history = useRef<{ person: Person; kind: 'like' | 'pass' }[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [demoMatchedIds, setDemoMatchedIds] = useState<string[]>(DEMO_MATCHED_IDS);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [premiumPlan, setPremiumPlan] = useState<EntitlementId>('match_plus');
  const [tier, setTier] = useState<Tier>('free');
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

  /* ---------- subscriptions / entitlement ---------- */
  const refreshTier = useCallback(async (): Promise<Tier> => {
    if (!user?.id) {
      setTier('free');
      return 'free';
    }
    const t = await fetchServerTier();
    setTier(t);
    return t;
  }, [user?.id]);

  useEffect(() => {
    void configureIap(user?.id ?? null);
    if (!user?.id) {
      setTier('free');
      return;
    }
    void refreshTier();
    const ch = supabase
      .channel(`subs:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${user.id}` }, () => {
        void refreshTier();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user?.id, refreshTier]);

  const openPaywall = useCallback((plan: EntitlementId = 'match_plus') => {
    setPremiumPlan(plan);
    setPremiumOpen(true);
  }, []);

  const requirePremium = useCallback(
    (min: EntitlementId, reason?: string) => {
      const ok = min === 'match_plus' ? tier !== 'free' : tier === 'super_match';
      if (ok) return true;
      if (reason) toast(reason);
      openPaywall(min);
      return false;
    },
    [tier, toast, openPaywall]
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

  const reloadPeople = useCallback(async (opts?: { includePassed?: boolean }) => {
    if (!user?.id || !meForCompat) return;
    setPeopleLoading(true);
    setPeopleError(null);
    try {
      const rows = await fetchDiscoverDeck(user.id, { ...deckFilters, includePassed: !!opts?.includePassed });
      setRealPeople(rows.map((r) => personFromDiscover(meForCompat, r)));
    } catch (err) {
      setPeopleError(friendlyError(err, 'Failed to load people'));
    } finally {
      setPeopleLoading(false);
    }
  }, [user?.id, meForCompat, deckFilters]);

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
      history.current = [];
      setRewoundId(null);
      setRealPeople([]);
      setMyPhoto(null);
      setMyInterests([]);
      // Don't leak the previous account's state to the next sign-in on this phone.
      setRemoved(new Set());
      setMatch(null);
      setTier('free');
      setDeckFilters({});
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
      if (rewoundId === p.id) setRewoundId(null);
      const overlay: MatchOverlayData = { name: p.name, photo: p.photo, myPhoto, myName: profile?.name || 'You' };
      if (!p.real) {
        history.current.push({ person: p, kind: 'like' });
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
        history.current.push({ person: p, kind: 'like' });
        if (row) {
          setMatch({ data: overlay, person: p, matchId: row.id });
          void pushLatestNotification(p.id);
        } else if (opts?.superLike) {
          // DB trigger wrote a 'super_like' notification — push it right away.
          void pushLatestNotification(p.id);
          toast(`Super like sent to ${p.name} ⭐ — they'll see you first`);
        } else {
          toast(`Like sent to ${p.name} 💫`);
        }
      } catch (err) {
        setLikedIds((s) => {
          const n = new Set(s);
          n.delete(p.id);
          return n;
        });
        const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? 'Could not send like');
        if (msg.includes('daily_like_limit')) {
          toast("You're out of likes for today — MATCH+ is unlimited");
          openPaywall('match_plus');
        } else if (msg.includes('super_like_limit')) {
          toast('No super likes left today');
          openPaywall(tier === 'match_plus' ? 'super_match' : 'match_plus');
        } else {
          toast(msg.includes('duplicate') ? `You already liked ${p.name}` : friendlyError(err, 'Could not send like — try again'));
        }
      }
    },
    [user?.id, likedIds, myPhoto, profile?.name, toast, openPaywall, tier, rewoundId]
  );

  const pass = useCallback(
    (p: Person) => {
      setPassedIds((s) => new Set(s).add(p.id));
      if (rewoundId === p.id) setRewoundId(null);
      history.current.push({ person: p, kind: 'pass' });
      if (p.real) recordPass(p.id).catch((e) => console.warn('[match] record_pass failed', e));
    },
    [rewoundId]
  );
  const removePerson = useCallback((id: string) => setRemoved((s) => new Set(s).add(id)), []);
  const resetDeck = useCallback(() => {
    setPassedIds(new Set());
    setLikedIds((s) => new Set([...s].filter((id) => !id.startsWith('demo-'))));
    void reloadPeople({ includePassed: true });
  }, [reloadPeople]);

  const unswipeLocal = useCallback((id: string) => {
    const drop = (s: Set<string>) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    };
    setLikedIds(drop);
    setPassedIds(drop);
    setDemoMatchedIds((m) => m.filter((x) => x !== id));
    setRewoundId(id);
  }, []);

  const rewind = useCallback(async (): Promise<string | null> => {
    if (!requirePremium('match_plus', 'Rewind is part of MATCH+')) return null;
    const last = history.current[history.current.length - 1];
    if (last && !last.person.real) {
      history.current.pop();
      unswipeLocal(last.person.id);
      toast(`Rewound — ${last.person.name} is back`);
      return last.person.id;
    }
    try {
      const r = await rewindLastSwipe();
      const prev = history.current.find((h) => h.person.id === r.targetId)?.person ?? realPeople.find((p) => p.id === r.targetId);
      history.current = history.current.filter((h) => h.person.id !== r.targetId);
      unswipeLocal(r.targetId);
      if (!realPeople.some((p) => p.id === r.targetId)) await reloadPeople();
      const name = prev?.name;
      toast(r.kind === 'like' ? `Like undone${name ? ` — ${name} is back` : ''}` : `Rewound${name ? ` — ${name} is back` : ''}`);
      return r.targetId;
    } catch (err) {
      const code = perkErrorCode(err);
      if (code === 'already_matched') toast("You already matched — that one can't be undone");
      else if (code === 'nothing_to_rewind') toast('Nothing to rewind (last 24h)');
      else if (code === 'premium_required') {
        toast('Rewind is part of MATCH+');
        openPaywall('match_plus');
      } else toast(code);
      return null;
    }
  }, [requirePremium, unswipeLocal, toast, realPeople, reloadPeople, openPaywall]);

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
      toast(friendlyError(err, 'Could not open chat'));
    }
  }, [match, router, toast]);

  /* ---------- notifications inbox (realtime) ---------- */
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const reloadRef = useRef(reloadPeople);
  reloadRef.current = reloadPeople;
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
      // A super like puts that person at the top of my deck right away.
      if (item.type === 'super_like' && !item.readAt) void reloadRef.current();
      setInbox((prev) => [item, ...prev.filter((x) => x.id !== item.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80));
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [user?.id]);
  const unreadCount = useMemo(() => inbox.filter((n) => !n.readAt).length, [inbox]);
  const clearInboxFor = useCallback((conversationId: string) => {
    setInbox((prev) => {
      if (!prev.some((n) => !n.readAt && n.type === 'message' && n.payload.conversation_id === conversationId)) return prev;
      const now = new Date().toISOString();
      return prev.map((n) => (!n.readAt && n.type === 'message' && n.payload.conversation_id === conversationId ? { ...n, readAt: now } : n));
    });
  }, []);

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
        await openNotificationTarget(router, n.type, n.payload);
      } catch (err) {
        toast(friendlyError(err, 'Could not open'));
      }
    },
    [closeNotifications, router, toast]
  );

  /* ---------- push taps → deep link (running + cold start) ---------- */
  const pendingTap = useRef<PushTap | null>(null);
  const flushTapRef = useRef<() => void>(() => {});
  flushTapRef.current = () => {
    const tap = pendingTap.current;
    if (!tap || !ready) return;
    pendingTap.current = null;
    const nid = typeof tap.data.notification_id === 'string' ? tap.data.notification_id : null;
    if (nid) {
      setInbox((prev) => prev.map((x) => (x.id === nid && !x.readAt ? { ...x, readAt: new Date().toISOString() } : x)));
      markRead(nid).catch(() => {});
    }
    openNotificationTarget(router, tap.type, tap.data).catch((err) => toast(friendlyError(err, 'Could not open')));
  };
  useEffect(
    () =>
      subscribePushTaps((tap) => {
        pendingTap.current = tap;
        flushTapRef.current();
      }),
    []
  );
  useEffect(() => {
    if (!ready) return;
    // Cold start: let AuthGate settle on the tabs first, then open the target screen.
    const t = setTimeout(() => flushTapRef.current(), 700);
    return () => clearTimeout(t);
  }, [ready]);

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
      deckFilters,
      setDeckFilters,
      personById,
      likedIds,
      passedIds,
      demoMatchedIds,
      like,
      pass,
      removePerson,
      resetDeck,
      rewind,
      rewoundId,
      toast,
      openNotifications: () => setNotifOpen(true),
      openPremium: () => openPaywall('match_plus'),
      inbox,
      unreadCount,
      clearInboxFor,
      tier,
      refreshTier,
      requirePremium,
    }),
    [me, refreshMe, people, peopleLoading, peopleError, reloadPeople, deckFilters, rewind, rewoundId, personById, likedIds, passedIds, demoMatchedIds, like, pass, removePerson, resetDeck, toast, inbox, unreadCount, clearInboxFor, tier, refreshTier, requirePremium, openPaywall]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <MatchOverlay data={match?.data ?? null} onClose={() => setMatch(null)} onMessage={onMatchMessage} />
      <NotificationsPanel visible={notifOpen} onClose={closeNotifications} items={notifItems} demoFallback={SHOW_DEMO_CONTENT} />
      <PremiumModal visible={premiumOpen} onClose={() => setPremiumOpen(false)} toast={toast} tier={tier} initialPlan={premiumPlan} refreshTier={refreshTier} />
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
