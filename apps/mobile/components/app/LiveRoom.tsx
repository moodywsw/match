import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Gift as GiftIcon, Heart, Radio, Send, Users, Video, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, IconBtn, LiveBadge, MatchRing, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { fetchChatList } from '@/lib/chat';
import {
  DEFAULT_QUESTION,
  endLive,
  fetchLiveChat,
  fetchLiveEligibility,
  fetchLiveState,
  joinLive,
  leaveLive,
  leaveSeat,
  likeFromLive,
  LIVE_HEARTBEAT_MS,
  LIVE_STATE_POLL_MS,
  liveErrorMessage,
  missingText,
  moderateLive,
  nextRound,
  pinLiveMessage,
  QUESTION_IDEAS,
  ROOM_TYPES,
  sendLiveChat,
  sendLiveReaction,
  subscribeLiveRoom,
  takeSeat,
  voteLiveMatch,
  type LiveChatLine,
  type LiveEligibility,
  type LiveRoomType,
  type LiveState,
  type StageMember,
} from '@/lib/live';
import { LIVE_CATS, LIVE_CHAT, type LiveRoom } from '@/lib/mock';
import { fetchPrimaryPhotos } from '@/lib/profile';
import { pushLatestNotification } from '@/lib/push';
import { supabase } from '@/lib/supabase';

import { inputStyle } from './AuthForm';
import { HostPeopleSheet, LiveProfileSheet, QuestionBanner, RoomTypeBadge, SpeedDatingPanel, StageStrip } from './LiveDating';
import { GiftOverlay, GiftSheet, TopGiftersPill, TopGiftersSheet, useGiftFeed } from './LiveGifts';
import { LiveVideo, type LiveVideoStatus } from './LiveVideo';
import { MatchOverlay, type MatchOverlayData } from './MatchOverlay';

export function LiveRoomView({ room, onClose }: { room: LiveRoom | null; onClose: () => void }) {
  // Android back goes through the room's own close (host gets the "End your live?" confirm).
  const closeRef = useRef<() => void>(onClose);
  return (
    <Modal visible={!!room} animationType="slide" statusBarTranslucent onRequestClose={() => closeRef.current()}>
      {room ? <Room room={room} onClose={onClose} closeRef={closeRef} /> : null}
    </Modal>
  );
}

type ChatEntry = { id: string; userId?: string; user: string; text: string; you?: boolean };

type RoomExtras = {
  roomType: LiveRoomType;
  question: string | null;
  commentsMuted: boolean;
  pinned: LiveState['pinned'];
  round: number;
  roundEndsAt: string | null;
  roundPair: string[] | null;
  stage: StageMember[];
  myStatus: 'ok' | 'muted';
  canInteract: boolean;
  role: string | null;
};

type RoomModel = RoomExtras & {
  status: 'live' | 'ended';
  removed: boolean;
  viewers: number;
  reactions: number;
  votes: { yes: number; no: number; mine: boolean | null };
  chat: ChatEntry[];
  sendChat: (text: string) => Promise<boolean>;
  react: () => void;
  vote: (yes: boolean) => void;
  refresh: () => Promise<void>;
};

/** Local toast: the app-wide toast renders under this Modal, so the room shows its own. */
function useRoomToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: string) => {
      setMsg(m);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 2600);
    },
    [anim]
  );
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  return { msg, anim, show };
}

const DEMO_EXTRAS = (room: LiveRoom): RoomExtras => ({
  roomType: room.roomType ?? 'standard',
  question: room.question ?? null,
  commentsMuted: false,
  pinned: null,
  round: 0,
  roundEndsAt: null,
  roundPair: null,
  stage: [],
  myStatus: 'ok',
  canInteract: true,
  role: null,
});

/** Demo rooms (SHOW_DEMO_CONTENT prototype previews) keep the original local-only behaviour. */
function useDemoRoom(room: LiveRoom): RoomModel {
  const [reactions, setReactions] = useState(0);
  const [votes, setVotes] = useState({ yes: 61, no: 39, mine: null as boolean | null });
  const [chat, setChat] = useState<ChatEntry[]>(LIVE_CHAT.map((c, i) => ({ id: `demo-${i}`, ...c })));
  return {
    ...DEMO_EXTRAS(room),
    status: 'live',
    removed: false,
    viewers: room.viewers,
    reactions,
    votes,
    chat,
    sendChat: async (text) => {
      setChat((c) => [...c, { id: `local-${Date.now()}`, user: 'You', text, you: true }]);
      return true;
    },
    react: () => setReactions((r) => r + 1),
    vote: (yes) => setVotes((v) => ({ yes: v.yes + (yes ? 1 : 0), no: v.no + (yes ? 0 : 1), mine: yes })),
    refresh: async () => {},
  };
}

/** Server-backed room: join/heartbeat, realtime chat, reaction batching, votes, stage + rounds + moderation state. */
function useRealRoom(room: LiveRoom, enabled: boolean, toast: (m: string) => void): RoomModel {
  const { user } = useAuth();
  const [status, setStatus] = useState<'live' | 'ended'>('live');
  const [removed, setRemoved] = useState(false);
  const [viewers, setViewers] = useState(room.viewers);
  const [reactions, setReactions] = useState(room.reactions ?? 0);
  const [votes, setVotes] = useState<{ yes: number; no: number; mine: boolean | null }>({ yes: 0, no: 0, mine: null });
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [extras, setExtras] = useState<RoomExtras>(() => DEMO_EXTRAS(room));
  const pendingReactions = useRef(0);
  const roleRef = useRef<string | null>(null);
  const uid = user?.id;

  const toEntry = useCallback(
    (l: LiveChatLine): ChatEntry => ({ id: l.id, userId: l.userId, user: l.userId === uid ? 'You' : l.user, text: l.text, you: l.userId === uid }),
    [uid]
  );
  const append = useCallback((e: ChatEntry) => setChat((c) => (c.some((x) => x.id === e.id) ? c : [...c, e].slice(-80))), []);

  const refreshState = useCallback(async () => {
    try {
      const s = await fetchLiveState(room.id);
      if (!s) return;
      setStatus(s.status);
      setViewers(s.viewers);
      setReactions((r) => Math.max(r, s.reactions));
      setVotes({ yes: s.yes_votes, no: s.no_votes, mine: s.my_vote });
      setExtras((prev) => ({
        roomType: (s.room_type as LiveRoomType) ?? prev.roomType,
        question: s.question ?? null,
        commentsMuted: !!s.comments_muted,
        pinned: s.pinned ?? null,
        round: s.round_number ?? 0,
        roundEndsAt: s.round_ends_at ?? null,
        roundPair: s.round_pair ?? null,
        stage: Array.isArray(s.stage) ? s.stage : [],
        myStatus: s.my_status === 'muted' ? 'muted' : 'ok',
        canInteract: s.can_interact !== false,
        role: roleRef.current,
      }));
    } catch {
      /* transient */
    }
  }, [room.id]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const beat = async () => {
      try {
        roleRef.current = await joinLive(room.id);
      } catch (e) {
        if (!alive) return;
        const msg = (e as { message?: string })?.message ?? '';
        if (msg.includes('stream_ended')) setStatus('ended');
        else if (msg.includes('removed_from_live') || msg.includes('not_allowed')) {
          setStatus('ended');
          setRemoved(msg.includes('removed_from_live'));
          toast(liveErrorMessage(e));
        }
      }
    };
    void beat().then(refreshState);
    fetchLiveChat(room.id)
      .then((lines) => alive && setChat(lines.map(toEntry)))
      .catch(() => {});
    const sub = subscribeLiveRoom(room.id, {
      onChat: (l) => append(toEntry(l)),
      onReaction: (n) => setReactions((r) => r + n),
    });
    const hb = setInterval(beat, LIVE_HEARTBEAT_MS);
    const poll = setInterval(refreshState, LIVE_STATE_POLL_MS);
    const flush = setInterval(() => {
      const n = Math.min(20, pendingReactions.current);
      if (!n) return;
      pendingReactions.current -= n;
      sub.sendReactionBurst(n);
      sendLiveReaction(room.id, n).catch(() => {});
    }, 1500);
    return () => {
      alive = false;
      clearInterval(hb);
      clearInterval(poll);
      clearInterval(flush);
      sub.unsubscribe();
      if (roleRef.current === 'viewer' || roleRef.current === 'dater') void leaveLive(room.id);
    };
  }, [enabled, room.id, refreshState, toEntry, append, toast]);

  return {
    ...extras,
    status,
    removed,
    viewers,
    reactions,
    votes,
    chat,
    refresh: refreshState,
    sendChat: async (text) => {
      try {
        const res = await sendLiveChat(room.id, text);
        if (res) append({ id: res.id, userId: uid, user: 'You', text: text.trim().slice(0, 200), you: true });
        return true;
      } catch (e) {
        toast(liveErrorMessage(e));
        return false;
      }
    },
    react: () => {
      if (status !== 'live') return;
      pendingReactions.current += 1;
      setReactions((r) => r + 1);
    },
    vote: (yes) => {
      if (status !== 'live') return;
      setVotes((v) => {
        const yesN = v.yes + (yes ? 1 : 0) - (v.mine === true ? 1 : 0);
        const noN = v.no + (yes ? 0 : 1) - (v.mine === false ? 1 : 0);
        return { yes: Math.max(0, yesN), no: Math.max(0, noN), mine: yes };
      });
      voteLiveMatch(room.id, yes)
        .then(refreshState)
        .catch((e) => {
          toast(liveErrorMessage(e));
          void refreshState();
        });
    },
  };
}

function videoNote(s: LiveVideoStatus | null): string | null {
  switch (s) {
    case 'unsupported':
      return 'Video live is available in the app build — chat, reactions and votes are live here';
    case 'not_configured':
      return 'Video is being set up — chat, reactions and votes are live';
    case 'connecting':
      return 'Connecting video…';
    case 'not_allowed':
    case 'error':
      return 'Video unavailable right now';
    default:
      return null;
  }
}

/** Speed dating stage size (host included) — app_settings, with safe defaults. */
function useSpeedLimits(active: boolean) {
  const [lim, setLim] = useState({ min: 3, max: 4 });
  useEffect(() => {
    if (!active) return;
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['speed_min_participants', 'speed_max_participants'])
      .then(({ data }) => {
        const get = (k: string, d: number) => Number((data || []).find((r) => r.key === k)?.value) || d;
        setLim({ min: Math.max(2, get('speed_min_participants', 3)), max: get('speed_max_participants', 4) });
      });
  }, [active]);
  return lim;
}

function Room({
  room,
  onClose,
  closeRef,
}: {
  room: LiveRoom;
  onClose: () => void;
  closeRef: { current: () => void };
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { me } = useApp();
  const rt = useRoomToast();
  const real = !!room.real;
  const demoModel = useDemoRoom(room);
  const realModel = useRealRoom(room, real, rt.show);
  const m = real ? realModel : demoModel;
  const [chatInput, setChatInput] = useState('');
  const [videoStatus, setVideoStatus] = useState<LiveVideoStatus | null>(null);
  const feed = useGiftFeed(room.id, real);
  const [giftOpen, setGiftOpen] = useState(false);
  const [topOpen, setTopOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [lineMenu, setLineMenu] = useState<ChatEntry | null>(null);
  const [elig, setElig] = useState<LiveEligibility | null>(null);
  const [match, setMatch] = useState<{ data: MatchOverlayData; conversationId: string | null; otherId: string } | null>(null);
  const [stagePhotos, setStagePhotos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const ended = m.status === 'ended';
  const isHost = !!room.isSelf;
  const isGuest = !!room.guestId && room.guestId === user?.id;
  const onStage = isHost || isGuest || m.role === 'dater';
  const speed = m.roomType === 'speed_dating';
  const qotn = m.roomType === 'question_night';
  const lim = useSpeedLimits(real && speed);

  useEffect(() => {
    if (!real) return;
    fetchLiveEligibility()
      .then(setElig)
      .catch(() => {});
  }, [real]);

  // primary photos for whoever is on stage
  const stageKey = m.stage.map((s) => s.id).join(',');
  useEffect(() => {
    const ids = stageKey ? stageKey.split(',') : [];
    const missing = ids.filter((id) => !(id in stagePhotos));
    if (!missing.length) return;
    fetchPrimaryPhotos(missing)
      .then((p) => setStagePhotos((cur) => ({ ...cur, ...p, ...Object.fromEntries(missing.filter((id) => !p[id]).map((id) => [id, ''])) })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey]);

  const nameOf = useCallback((id: string) => m.stage.find((s) => s.id === id)?.name ?? 'Someone', [m.stage]);
  const pairNames = useMemo<[string, string] | null>(
    () => (m.roundPair && m.roundPair.length === 2 ? [m.roundPair[0] === user?.id ? 'You' : nameOf(m.roundPair[0]), m.roundPair[1] === user?.id ? 'you' : nameOf(m.roundPair[1])] : null),
    [m.roundPair, nameOf, user?.id]
  );

  const commentsBlocked = !onStage && (m.commentsMuted || m.myStatus === 'muted' || !m.canInteract);
  const placeholder = ended
    ? 'Chat is closed'
    : !onStage && m.commentsMuted
      ? 'The host turned comments off'
      : m.myStatus === 'muted'
        ? "You're muted in this live"
        : !m.canInteract && !onStage
          ? 'Complete your profile to comment'
          : qotn
            ? 'Your answer…'
            : 'Say something…';
  const gateText = elig && !elig.can_interact ? `${missingText(elig.missing)} to comment and send gifts — watching is always open.` : null;

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || ended) return;
    if (commentsBlocked) {
      rt.show(gateText && !m.canInteract ? gateText : placeholder);
      return;
    }
    setChatInput('');
    const ok = await m.sendChat(text);
    if (!ok) setChatInput(text);
  };

  const like = async (targetId: string, name: string) => {
    if (!real) {
      rt.show(`Like sent to ${name} 💫`);
      return;
    }
    try {
      const r = await likeFromLive(room.id, targetId);
      void m.refresh();
      if (r.matched) {
        const photo = stagePhotos[targetId] || (await fetchPrimaryPhotos([targetId]).catch(() => ({}) as Record<string, string>))[targetId] || null;
        setMatch({
          data: { name: r.name || name, photo, myPhoto: me?.photo ?? null, myName: profile?.name || 'You' },
          conversationId: r.conversation_id,
          otherId: targetId,
        });
        void pushLatestNotification(targetId);
      } else {
        rt.show(`Like sent to ${r.name || name} 💫 — if they like you back, it's a match`);
      }
    } catch (e) {
      rt.show(liveErrorMessage(e));
    }
  };

  const openMatchChat = async () => {
    const cur = match;
    setMatch(null);
    if (!cur) return;
    if (isHost || m.role === 'dater') {
      rt.show(`Your chat with ${cur.data.name} is waiting in Messages`);
      return;
    }
    onClose();
    if (cur.conversationId) router.push({ pathname: '/chat/[conversationId]', params: { conversationId: cur.conversationId } });
  };

  const doNextRound = async () => {
    setBusy(true);
    try {
      await nextRound(room.id);
      await m.refresh();
    } catch (e) {
      rt.show(liveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const doSeat = async () => {
    setBusy(true);
    try {
      await takeSeat(room.id);
      await m.refresh();
      rt.show("You're on stage — the host will start the next round");
    } catch (e) {
      rt.show(liveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const doLeaveSeat = async () => {
    try {
      await leaveSeat(room.id);
      await m.refresh();
    } catch (e) {
      rt.show(liveErrorMessage(e));
    }
  };

  const lineAction = async (entry: ChatEntry, action: 'like' | 'pin' | 'mute' | 'remove') => {
    setLineMenu(null);
    if (!entry.userId) return;
    if (action === 'like') return like(entry.userId, entry.user);
    try {
      if (action === 'pin') await pinLiveMessage(room.id, entry.id);
      else await moderateLive(room.id, entry.userId, action);
      await m.refresh();
      rt.show(action === 'pin' ? 'Pinned' : action === 'mute' ? `${entry.user} is muted` : `${entry.user} was removed`);
    } catch (e) {
      rt.show(liveErrorMessage(e));
    }
  };

  const close = () => {
    if (!real || !isHost || ended) {
      onClose();
      return;
    }
    Alert.alert('End your live?', 'Viewers will see that the live has ended.', [
      { text: 'Keep streaming', style: 'cancel' },
      {
        text: 'End live',
        style: 'destructive',
        onPress: () => {
          endLive(room.id).catch(() => {});
          onClose();
        },
      },
    ]);
  };
  closeRef.current = close;

  const totalVotes = m.votes.yes + m.votes.no;
  const yesPct = totalVotes ? Math.round((m.votes.yes / totalVotes) * 100) : 0;
  const note = real ? videoNote(videoStatus) : null;
  const showCover = !real || videoStatus !== 'live';
  const peek = peekId ? m.stage.find((s) => s.id === peekId) : null;
  const seated = m.role === 'dater';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.ink }} behavior="padding">
      {showCover && room.cover ? <Image source={{ uri: room.cover }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} resizeMode="cover" /> : null}
      {real && !ended ? <LiveVideo streamId={room.id} onStatus={setVideoStatus} /> : null}
      <LinearGradient colors={['rgba(10,8,14,0.5)', 'rgba(10,8,14,0.2)', 'rgba(10,8,14,0.9)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBtn onPress={close} label={isHost && !ended ? 'End live' : 'Close'}>
          <X size={17} color={T.text} />
        </IconBtn>
        {ended ? (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
            <Txt w={700} size={10.5} color="#fff">
              ENDED
            </Txt>
          </View>
        ) : (
          <LiveBadge size={10.5} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Users size={13} color="#fff" />
          <Txt size={12} color="#fff">
            {m.viewers}
          </Txt>
        </View>
        <View style={{ flex: 1 }} />
        {real && (isHost || isGuest) && !ended ? (
          <Pressable onPress={() => setPeopleOpen(true)} accessibilityRole="button" accessibilityLabel="People and moderation" style={[styles.pill, { borderColor: m.commentsMuted ? T.rose : T.border }]}>
            <Users size={13} color="#fff" />
            <Txt w={600} size={11.5} color="#fff">
              People
            </Txt>
          </Pressable>
        ) : null}
        <TopGiftersPill top={feed.top} onPress={() => setTopOpen(true)} />
        {!m.stage.length ? (
          <>
            {room.host ? <Avatar uri={room.host.photo} name={room.host.name} size={32} ring={T.rose} /> : null}
            {room.guest ? <Avatar uri={room.guest.photo} name={room.guest.name} size={32} ring={T.violet} style={{ marginLeft: -14 }} /> : null}
          </>
        ) : null}
      </View>

      {m.roomType !== 'standard' ? (
        <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
          <RoomTypeBadge type={m.roomType} />
        </View>
      ) : null}

      {real ? (
        <StageStrip
          stage={m.stage}
          photos={{ ...stagePhotos, ...(user?.id && me?.photo ? { [user.id]: me.photo } : {}) }}
          meId={user?.id}
          spotlight={speed ? m.roundPair : null}
          onOpen={(s) => (s.id === user?.id ? null : setPeekId(s.id))}
          onLike={(s) => void like(s.id, s.name)}
        />
      ) : null}

      {note ? (
        <View style={{ marginTop: 10, marginHorizontal: 16, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(30,25,40,0.75)', borderWidth: 1, borderColor: T.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Video size={13} color={T.muted} />
          <Txt size={11.5} color={T.muted} style={{ flexShrink: 1 }}>
            {note}
          </Txt>
        </View>
      ) : null}

      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
        <Txt v="display" size={20} color="#fff" style={{ marginBottom: 4 }} numberOfLines={2}>
          {room.title}
        </Txt>
        {ended ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Radio size={13} color={T.muted} />
            <Txt size={12} color={T.muted}>
              {m.removed ? 'The host removed you from this live' : 'This live has ended'}
            </Txt>
          </View>
        ) : isHost ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Radio size={13} color={T.mint} />
            <Txt size={12} color={T.mint}>
              {m.viewers > 0 ? `You're live — ${m.viewers} watching` : "You're live — viewers are joining"}
            </Txt>
          </View>
        ) : null}

        {speed ? (
          <SpeedDatingPanel
            round={m.round}
            endsAt={m.roundEndsAt}
            pairNames={pairNames}
            stageCount={real ? Math.max(1, m.stage.length) : (room.daters ?? 0) + 1}
            minPeople={lim.min}
            maxPeople={lim.max}
            isHost={isHost}
            seated={seated}
            ended={ended || !real}
            busy={busy}
            onNext={doNextRound}
            onSeat={doSeat}
            onLeaveSeat={doLeaveSeat}
          />
        ) : null}

        {qotn ? (
          <QuestionBanner
            question={m.question || DEFAULT_QUESTION}
            pinned={m.pinned ? { name: m.pinned.user_id === user?.id ? 'You' : m.pinned.name, body: m.pinned.body } : null}
            onAnswerWithFriday={!ended && profile?.friday_answer && !commentsBlocked ? () => setChatInput(profile.friday_answer ?? '') : undefined}
          />
        ) : null}

        {room.liveMatch ? (
          <View style={{ backgroundColor: 'rgba(30,25,40,0.75)', borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 16, marginVertical: 10 }}>
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <MatchRing percent={real ? (totalVotes ? yesPct : 50) : 78} size={70} />
            </View>
            <Txt size={12.5} color={T.muted} center style={{ marginBottom: 12 }}>
              Should {room.host?.name} & {room.guest?.name} match?
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable disabled={ended || onStage} onPress={() => m.vote(true)} style={{ flex: 1, opacity: m.votes.mine === false ? 0.7 : 1 }}>
                <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ padding: 10, borderRadius: 12, alignItems: 'center', borderWidth: m.votes.mine === true ? 1.5 : 0, borderColor: '#fff' }}>
                  <Txt w={700} color="#fff">
                    ❤️ Yes {real ? yesPct : m.votes.yes}%
                  </Txt>
                </LinearGradient>
              </Pressable>
              <Pressable disabled={ended || onStage} onPress={() => m.vote(false)} style={{ flex: 1, padding: 10, borderRadius: 12, borderWidth: m.votes.mine === false ? 1.5 : 1, borderColor: m.votes.mine === false ? '#fff' : T.border, alignItems: 'center' }}>
                <Txt w={700} color="#fff">
                  No {real ? (totalVotes ? 100 - yesPct : 0) : m.votes.no}%
                </Txt>
              </Pressable>
            </View>
          </View>
        ) : null}

        <ScrollView ref={scrollRef} style={{ maxHeight: speed || qotn ? 100 : 130, marginBottom: 10 }} contentContainerStyle={{ gap: 6 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {m.chat.map((c) => (
            <Pressable
              key={c.id}
              disabled={!real || c.you || !c.userId || !(isHost || isGuest || seated)}
              onLongPress={() => setLineMenu(c)}
              onPress={() => (isHost || isGuest || seated) && setLineMenu(c)}
            >
              <Txt size={12.5} color="#EDE7F5">
                <Txt w={700} size={12.5} color={c.you ? T.mint : c.userId && c.userId === room.hostId ? T.rose : T.amber}>
                  {c.user}
                </Txt>{' '}
                {c.text}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>

        {real && !ended && gateText && !onStage ? (
          <Pressable
            onPress={() => {
              onClose();
              router.push('/profile');
            }}
            style={{ marginBottom: 8, padding: 10, borderRadius: 12, backgroundColor: 'rgba(30,25,40,0.8)', borderWidth: 1, borderColor: `${T.amber}66` }}
          >
            <Txt size={11.5} color="#fff">
              {gateText} <Txt w={700} size={11.5} color={T.amber}>Complete profile →</Txt>
            </Txt>
          </Pressable>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', opacity: ended ? 0.5 : 1 }}>
          <TextInput
            value={chatInput}
            onChangeText={setChatInput}
            onSubmitEditing={sendChat}
            editable={!ended && !commentsBlocked}
            maxLength={200}
            placeholder={placeholder}
            placeholderTextColor={T.muted}
            style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: 'rgba(38,32,47,0.8)', color: '#fff', fontSize: 13, ...body(400) }}
          />
          <Pressable onPress={sendChat} disabled={ended} accessibilityLabel="Send" style={[styles.roundGlass, commentsBlocked && { opacity: 0.5 }]}>
            <Send size={16} color="#fff" />
          </Pressable>
          {!isHost && !ended ? (
            <Pressable
              onPress={() => (real && elig && !elig.can_interact ? rt.show(gateText ?? 'Complete your profile to send gifts') : setGiftOpen(true))}
              accessibilityRole="button"
              accessibilityLabel="Send a gift"
              style={[styles.roundGlass, { backgroundColor: T.amber }]}
            >
              <GiftIcon size={18} color="#1a1a1a" />
            </Pressable>
          ) : null}
          <Pressable onPress={m.react} disabled={ended} accessibilityLabel="Send a heart" style={[styles.roundGlass, { backgroundColor: T.rose }]}>
            <Heart size={18} color="#fff" fill="#fff" />
            {m.reactions > 0 ? (
              <View style={{ position: 'absolute', top: -6, right: -6, backgroundColor: T.amber, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Txt w={700} size={9} color="#1a1a1a">
                  {m.reactions > 999 ? `${Math.floor(m.reactions / 1000)}k` : m.reactions}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {rt.msg ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: insets.top + 60, left: 20, right: 20, alignItems: 'center', opacity: rt.anim, transform: [{ translateY: rt.anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}
        >
          <View style={{ backgroundColor: 'rgba(20,16,26,0.95)', borderWidth: 1, borderColor: T.border, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 }}>
            <Txt size={12.5} color="#fff" center>
              {rt.msg}
            </Txt>
          </View>
        </Animated.View>
      ) : null}

      <GiftOverlay show={feed.current} onDone={feed.done} />
      <GiftSheet
        visible={giftOpen}
        onClose={() => setGiftOpen(false)}
        streamId={room.id}
        real={real}
        gifts={feed.gifts}
        hostName={room.host?.name ?? 'the host'}
        onSent={(g) => {
          feed.enqueue(g);
          feed.refreshTop();
        }}
      />
      <TopGiftersSheet visible={topOpen} onClose={() => setTopOpen(false)} top={feed.top} />
      {real ? (
        <HostPeopleSheet
          visible={peopleOpen}
          streamId={room.id}
          commentsMuted={m.commentsMuted}
          onClose={() => setPeopleOpen(false)}
          onLike={(p) => like(p.user_id, p.name)}
          onError={rt.show}
          onChanged={() => void m.refresh()}
        />
      ) : null}
      <LiveProfileSheet
        userId={peekId}
        fallbackName={peek?.name}
        liked={!!peek?.liked}
        matched={!!peek?.matched}
        canLike
        onClose={() => setPeekId(null)}
        onLike={() => {
          const p = peek;
          setPeekId(null);
          if (p) void like(p.id, p.name);
        }}
      />
      <Sheet visible={!!lineMenu} onClose={() => setLineMenu(null)} scrim={T.scrimDeep} title={lineMenu?.user ?? ''}>
        {lineMenu ? (
          <View style={{ gap: 8 }}>
            <Txt size={12.5} color={T.muted} style={{ marginBottom: 6 }} numberOfLines={3}>
              “{lineMenu.text}”
            </Txt>
            <PrimaryButton label={`Like ${lineMenu.user}`} onPress={() => void lineAction(lineMenu, 'like')} />
            {isHost ? (
              <>
                <PrimaryButton label={qotn ? 'Pin this answer' : 'Pin this comment'} colors={[T.violet, T.rose]} onPress={() => void lineAction(lineMenu, 'pin')} />
                <TextButton label={`Mute ${lineMenu.user}`} onPress={() => void lineAction(lineMenu, 'mute')} color={T.text} />
                <TextButton
                  label={`Remove ${lineMenu.user} from this live`}
                  color={T.rose}
                  onPress={() => {
                    const entry = lineMenu;
                    Alert.alert(`Remove ${entry.user}?`, "They'll leave this live and can't come back to it.", [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => void lineAction(entry, 'remove') },
                    ]);
                  }}
                />
              </>
            ) : null}
            <TextButton label="Cancel" onPress={() => setLineMenu(null)} size={13} />
          </View>
        ) : null}
      </Sheet>
      <MatchOverlay data={match?.data ?? null} onClose={() => setMatch(null)} onMessage={() => void openMatchChat()} />
    </KeyboardAvoidingView>
  );
}

type GuestOption = { id: string; name: string; photo: string | null };

export function GoLiveSheet({
  visible,
  onClose,
  onStart,
  busy,
  eligibility,
  onFixProfile,
}: {
  visible: boolean;
  onClose: () => void;
  onStart: (title: string, category: string, guest: GuestOption | null, roomType: LiveRoomType, question: string | null) => void;
  busy?: boolean;
  eligibility?: LiveEligibility | null;
  onFixProfile?: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Talk');
  const [roomType, setRoomType] = useState<LiveRoomType>('standard');
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [guest, setGuest] = useState<GuestOption | null>(null);
  const blocked = eligibility && !eligibility.can_host ? eligibility : null;

  useEffect(() => {
    if (!visible || !user?.id || blocked) return;
    fetchChatList(user.id)
      .then((rows) => setGuests(rows.slice(0, 12).map((r) => ({ id: r.otherUserId, name: r.otherName, photo: r.otherPhoto }))))
      .catch(() => setGuests([]));
  }, [visible, user?.id, blocked]);

  const defaultTitle = roomType === 'speed_dating' ? 'Speed dating' : roomType === 'question_night' ? 'Question of the night' : 'Untitled live';

  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Go Live" icon={<Radio size={17} color={T.rose} />}>
      {blocked ? (
        <>
          <Txt size={13} color={T.text} lh={1.5} style={{ marginTop: -6, marginBottom: 16 }}>
            {blocked.host_block === 'account_too_new'
              ? `Hosting opens once your account is ${blocked.host_min_days} days old${blocked.host_ready_at ? ` — from ${new Date(blocked.host_ready_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}. It keeps lives safe from throwaway accounts.`
              : blocked.host_block === 'profile_incomplete'
                ? `${missingText(blocked.missing)} to go live — hosts need a complete profile so viewers know who they're talking to.`
                : blocked.host_block === 'incognito_live'
                  ? 'Turn off incognito to go live — hosting shows your profile to everyone in the room.'
                  : "You can't go live right now."}
          </Txt>
          <Txt size={12} color={T.muted} style={{ marginBottom: 18 }}>
            You can still watch any live{eligibility?.can_interact ? ', chat and send gifts.' : '.'}
          </Txt>
          {blocked.host_block === 'profile_incomplete' || blocked.host_block === 'incognito_live' ? (
            <PrimaryButton label={blocked.host_block === 'incognito_live' ? 'Open privacy settings' : 'Complete my profile'} onPress={onFixProfile} />
          ) : null}
          <TextButton label="Close" onPress={onClose} size={13} />
        </>
      ) : (
        <>
          <Txt size={12.5} color={T.muted} style={{ marginTop: -10, marginBottom: 14 }}>
            Pick a format, add a title — start whenever you're ready.
          </Txt>
          <View style={{ gap: 8, marginBottom: 14 }}>
            {ROOM_TYPES.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => setRoomType(t.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: roomType === t.id }}
                style={{ padding: 12, borderRadius: 14, borderWidth: 1, borderColor: roomType === t.id ? T.rose : T.border, backgroundColor: roomType === t.id ? `${T.rose}18` : T.surface2 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt w={700} size={13.5}>
                    {t.id === 'speed_dating' ? '⚡ ' : t.id === 'question_night' ? '🌙 ' : '🎥 '}
                    {t.label}
                  </Txt>
                </View>
                <Txt size={11.5} color={T.muted} style={{ marginTop: 3 }}>
                  {t.blurb}
                </Txt>
              </Pressable>
            ))}
          </View>
          <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder={roomType === 'standard' ? "What's this live about?" : defaultTitle} placeholderTextColor={T.mutedDim} style={[inputStyle, { fontSize: 13.5, paddingVertical: 14, borderRadius: 14, marginBottom: 14 }]} />
          {roomType === 'question_night' ? (
            <>
              <TextInput value={question} onChangeText={setQuestion} maxLength={140} placeholder="Tonight's question" placeholderTextColor={T.mutedDim} style={[inputStyle, { fontSize: 13.5, paddingVertical: 14, borderRadius: 14, marginBottom: 10 }]} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }} contentContainerStyle={{ gap: 8 }}>
                {QUESTION_IDEAS.map((q) => (
                  <Chip key={q} label={q.length > 34 ? `${q.slice(0, 32)}…` : q} active={question === q} onPress={() => setQuestion(q)} small />
                ))}
              </ScrollView>
            </>
          ) : null}
          {roomType === 'standard' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {LIVE_CATS.filter((c) => c !== 'Trending').map((c) => (
                <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          ) : null}
          {roomType === 'standard' && guests.length ? (
            <>
              <Txt w={600} size={12.5} color={T.muted} style={{ marginBottom: 10 }}>
                💘 LIVE MATCH — invite a match (optional)
              </Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8 }}>
                {guests.map((g) => (
                  <Chip key={g.id} label={g.name} active={guest?.id === g.id} onPress={() => setGuest((cur) => (cur?.id === g.id ? null : g))} />
                ))}
              </ScrollView>
            </>
          ) : null}
          <Txt size={11} color={T.mutedDim} style={{ marginBottom: 12 }}>
            You can remove or mute anyone, or turn comments off. Your location is never shown in a live.
          </Txt>
          <PrimaryButton
            label={busy ? 'Starting…' : 'Start streaming'}
            onPress={() => !busy && onStart(title.trim() || defaultTitle, roomType === 'standard' ? category : 'Dating', roomType === 'standard' ? guest : null, roomType, roomType === 'question_night' ? question.trim() || DEFAULT_QUESTION : null)}
          />
          <TextButton label="Cancel" onPress={onClose} size={13} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  roundGlass: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: 'rgba(30,25,40,0.7)' },
});
