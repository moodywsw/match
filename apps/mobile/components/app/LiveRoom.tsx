import { LinearGradient } from 'expo-linear-gradient';
import { Gift as GiftIcon, Heart, Radio, Send, Users, Video, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, IconBtn, LiveBadge, MatchRing, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { fetchChatList } from '@/lib/chat';
import {
  endLive,
  fetchLiveChat,
  fetchLiveState,
  joinLive,
  leaveLive,
  LIVE_HEARTBEAT_MS,
  LIVE_STATE_POLL_MS,
  liveErrorMessage,
  sendLiveChat,
  sendLiveReaction,
  subscribeLiveRoom,
  voteLiveMatch,
  type LiveChatLine,
} from '@/lib/live';
import { LIVE_CATS, LIVE_CHAT, type LiveRoom } from '@/lib/mock';

import { inputStyle } from './AuthForm';
import { GiftOverlay, GiftSheet, TopGiftersPill, TopGiftersSheet, useGiftFeed } from './LiveGifts';
import { LiveVideo, type LiveVideoStatus } from './LiveVideo';

export function LiveRoomView({ room, onClose }: { room: LiveRoom | null; onClose: () => void }) {
  // Android back goes through the room's own close (host gets the "End your live?" confirm).
  const closeRef = useRef<() => void>(onClose);
  return (
    <Modal visible={!!room} animationType="slide" statusBarTranslucent onRequestClose={() => closeRef.current()}>
      {room ? <Room room={room} onClose={onClose} closeRef={closeRef} /> : null}
    </Modal>
  );
}

type ChatEntry = { id: string; user: string; text: string; you?: boolean };

type RoomModel = {
  status: 'live' | 'ended';
  viewers: number;
  reactions: number;
  votes: { yes: number; no: number; mine: boolean | null };
  chat: ChatEntry[];
  sendChat: (text: string) => Promise<boolean>;
  react: () => void;
  vote: (yes: boolean) => void;
};

/** Demo rooms (SHOW_DEMO_CONTENT prototype previews) keep the original local-only behaviour. */
function useDemoRoom(room: LiveRoom): RoomModel {
  const [reactions, setReactions] = useState(0);
  const [votes, setVotes] = useState({ yes: 61, no: 39, mine: null as boolean | null });
  const [chat, setChat] = useState<ChatEntry[]>(LIVE_CHAT.map((c, i) => ({ id: `demo-${i}`, ...c })));
  return {
    status: 'live',
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
  };
}

/** Server-backed room: join/heartbeat, realtime chat, reaction batching, LIVE MATCH votes. */
function useRealRoom(room: LiveRoom, enabled: boolean): RoomModel {
  const { user } = useAuth();
  const { toast } = useApp();
  const [status, setStatus] = useState<'live' | 'ended'>('live');
  const [viewers, setViewers] = useState(room.viewers);
  const [reactions, setReactions] = useState(room.reactions ?? 0);
  const [votes, setVotes] = useState<{ yes: number; no: number; mine: boolean | null }>({ yes: 0, no: 0, mine: null });
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const pendingReactions = useRef(0);
  const burstRef = useRef<((n: number) => void) | null>(null);
  const roleRef = useRef<string | null>(null);
  const uid = user?.id;

  const toEntry = useCallback((l: LiveChatLine): ChatEntry => ({ id: l.id, user: l.userId === uid ? 'You' : l.user, text: l.text, you: l.userId === uid }), [uid]);
  const append = useCallback((e: ChatEntry) => setChat((c) => (c.some((x) => x.id === e.id) ? c : [...c, e].slice(-80))), []);

  const refreshState = useCallback(async () => {
    try {
      const s = await fetchLiveState(room.id);
      if (!s) return;
      setStatus(s.status);
      setViewers(s.viewers);
      setReactions((r) => Math.max(r, s.reactions));
      setVotes({ yes: s.yes_votes, no: s.no_votes, mine: s.my_vote });
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
        else if (msg.includes('not_allowed')) {
          setStatus('ended');
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
    burstRef.current = sub.sendReactionBurst;
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
      burstRef.current = null;
      if (roleRef.current === 'viewer') void leaveLive(room.id);
    };
  }, [enabled, room.id, refreshState, toEntry, append, toast]);

  return {
    status,
    viewers,
    reactions,
    votes,
    chat,
    sendChat: async (text) => {
      try {
        const res = await sendLiveChat(room.id, text);
        if (res) append({ id: res.id, user: 'You', text: text.trim().slice(0, 200), you: true });
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
  const { user } = useAuth();
  const real = !!room.real;
  const demoModel = useDemoRoom(room);
  const realModel = useRealRoom(room, real);
  const m = real ? realModel : demoModel;
  const [chatInput, setChatInput] = useState('');
  const [videoStatus, setVideoStatus] = useState<LiveVideoStatus | null>(null);
  const feed = useGiftFeed(room.id, real);
  const [giftOpen, setGiftOpen] = useState(false);
  const [topOpen, setTopOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const ended = m.status === 'ended';
  const isHost = !!room.isSelf;
  const onStage = isHost || (!!room.guestId && room.guestId === user?.id);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || ended) return;
    setChatInput('');
    const ok = await m.sendChat(text);
    if (!ok) setChatInput(text);
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.ink }} behavior="padding">
      {showCover && room.cover ? <Image source={{ uri: room.cover }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} resizeMode="cover" /> : null}
      {real && !ended ? <LiveVideo streamId={room.id} onStatus={setVideoStatus} /> : null}
      <LinearGradient colors={['rgba(10,8,14,0.5)', 'rgba(10,8,14,0.2)', 'rgba(10,8,14,0.9)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBtn onPress={close}>
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
        <TopGiftersPill top={feed.top} onPress={() => setTopOpen(true)} />
        {room.host ? <Avatar uri={room.host.photo} name={room.host.name} size={32} ring={T.rose} /> : null}
        {room.guest ? <Avatar uri={room.guest.photo} name={room.guest.name} size={32} ring={T.violet} style={{ marginLeft: -14 }} /> : null}
      </View>

      {note ? (
        <View style={{ marginTop: 10, marginHorizontal: 16, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(30,25,40,0.75)', borderWidth: 1, borderColor: T.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Video size={13} color={T.muted} />
          <Txt size={11.5} color={T.muted} style={{ flexShrink: 1 }}>
            {note}
          </Txt>
        </View>
      ) : null}

      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
        <Txt v="display" size={20} color="#fff" style={{ marginBottom: 4 }}>
          {room.title}
        </Txt>
        {ended ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Radio size={13} color={T.muted} />
            <Txt size={12} color={T.muted}>
              This live has ended
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

        <ScrollView ref={scrollRef} style={{ maxHeight: 130, marginBottom: 14 }} contentContainerStyle={{ gap: 6 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {m.chat.map((c) => (
            <Txt key={c.id} size={12.5} color="#EDE7F5">
              <Txt w={700} size={12.5} color={c.you ? T.mint : T.amber}>
                {c.user}
              </Txt>{' '}
              {c.text}
            </Txt>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', opacity: ended ? 0.5 : 1 }}>
          <TextInput
            value={chatInput}
            onChangeText={setChatInput}
            onSubmitEditing={sendChat}
            editable={!ended}
            maxLength={200}
            placeholder={ended ? 'Chat is closed' : 'Say something…'}
            placeholderTextColor={T.muted}
            style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: 'rgba(38,32,47,0.8)', color: '#fff', fontSize: 13, ...body(400) }}
          />
          <Pressable onPress={sendChat} disabled={ended} style={styles.roundGlass}>
            <Send size={16} color="#fff" />
          </Pressable>
          {!isHost && !ended ? (
            <Pressable onPress={() => setGiftOpen(true)} accessibilityRole="button" accessibilityLabel="Send a gift" style={[styles.roundGlass, { backgroundColor: T.amber }]}>
              <GiftIcon size={18} color="#1a1a1a" />
            </Pressable>
          ) : null}
          <Pressable onPress={m.react} disabled={ended} style={[styles.roundGlass, { backgroundColor: T.rose }]}>
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
    </KeyboardAvoidingView>
  );
}

type GuestOption = { id: string; name: string; photo: string | null };

export function GoLiveSheet({
  visible,
  onClose,
  onStart,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onStart: (title: string, category: string, guest: GuestOption | null) => void;
  busy?: boolean;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Talk');
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [guest, setGuest] = useState<GuestOption | null>(null);

  useEffect(() => {
    if (!visible || !user?.id) return;
    fetchChatList(user.id)
      .then((rows) => setGuests(rows.slice(0, 12).map((r) => ({ id: r.otherUserId, name: r.otherName, photo: r.otherPhoto }))))
      .catch(() => setGuests([]));
  }, [visible, user?.id]);

  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Go Live" icon={<Radio size={17} color={T.rose} />}>
      <Txt size={12.5} color={T.muted} style={{ marginTop: -10, marginBottom: 18 }}>
        Set a title and category — you can start whenever you're ready.
      </Txt>
      <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder="What's this live about?" placeholderTextColor={T.mutedDim} style={[inputStyle, { fontSize: 13.5, paddingVertical: 14, borderRadius: 14, marginBottom: 14 }]} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {LIVE_CATS.filter((c) => c !== 'Trending').map((c) => (
          <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      {guests.length ? (
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
      <PrimaryButton label={busy ? 'Starting…' : 'Start streaming'} onPress={() => !busy && onStart(title.trim() || 'Untitled live', category, guest)} />
      <TextButton label="Cancel" onPress={onClose} size={13} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  roundGlass: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
