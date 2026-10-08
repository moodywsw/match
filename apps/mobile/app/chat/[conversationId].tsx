import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Check, CheckCheck, Image as ImageIcon, Mic, MoreHorizontal, Phone, PhoneMissed, Send, Video } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImageBubble, RecordingBar, StaticVoiceBubble, useVoiceRecorder, VoiceBubble } from '@/components/app/ChatMedia';
import { SafetySheet } from '@/components/app/DiscoverParts';
import { Avatar, Backdrop, DemoTag, IconBtn } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCalls } from '@/contexts/CallContext';
import { callDurationLabel, type CallKind } from '@/lib/calls';
import { fetchConversationMeta, fetchMessages, joinTypingChannel, markConversationRead, sendMediaMessage, sendMessage, subscribeToMessages, type ChatMessage } from '@/lib/chat';
import { computeCompat } from '@/lib/compat';
import { fetchInterestLabelsForUsers } from '@/lib/interests';
import { avatar, CHAT_PREVIEWS, intentionLabel, PROFILES } from '@/lib/mock';
import { pushLatestNotification } from '@/lib/push';
import { blockUser, reportUser } from '@/lib/safety';
import { friendlyError } from '@/lib/errors';

type Msg = {
  id: string;
  mine: boolean;
  type: 'text' | 'image' | 'voice' | 'call';
  text?: string | null;
  /** demo image URL or local file while uploading */
  image?: string | null;
  /** demo voice label */
  duration?: string;
  mediaPath?: string | null;
  localUri?: string | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  pending?: boolean;
  real?: boolean;
  /** sent time (real messages) */
  at?: string | null;
  /** recipient read it (only set when their read receipts are on) */
  readAt?: string | null;
};

type Peer = { id: string; name: string; photo: string | null; online: boolean; match: number | null; icebreakers: string[] };

function TypingDots() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: T.surface2, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, borderBottomLeftRadius: 4, flexDirection: 'row', gap: 4 }}>
      {[0, 1, 2].map((d) => (
        <Animated.View
          key={d}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: T.muted,
            transform: [{ scaleY: v.interpolate({ inputRange: [0, 0.25 + d * 0.15, 0.5 + d * 0.15, 1], outputRange: [1, 1.3, 0.9, 1], extrapolate: 'clamp' }) }],
            opacity: v.interpolate({ inputRange: [0, 0.3 + d * 0.15, 1], outputRange: [0.5, 1, 0.5], extrapolate: 'clamp' }),
          }}
        />
      ))}
    </View>
  );
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Sent ✓ / read ✓✓ under my own messages. */
function Receipt({ m }: { m: Msg }) {
  if (!m.mine || !m.real) return null;
  const read = !!m.readAt;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-end', marginTop: 3, marginRight: 2 }}>
      <Txt v="mono" size={9.5} color={T.mutedDim}>
        {m.pending ? 'Sending…' : read ? `Read ${fmtTime(m.readAt)}` : fmtTime(m.at)}
      </Txt>
      {m.pending ? null : read ? <CheckCheck size={12} color={T.mint} /> : <Check size={12} color={T.mutedDim} />}
    </View>
  );
}

/** Centred call summary pill ("Missed video call", "Voice call · 3:12"). Tap to call back. */
function CallPill({ m, onCall }: { m: Msg; onCall?: (kind: CallKind) => void }) {
  const [status, k] = (m.text ?? 'ended:video').split(':');
  const kind: CallKind = k === 'audio' ? 'audio' : 'video';
  const Kind = kind === 'video' ? 'Video call' : 'Voice call';
  const missedForMe = !m.mine && status === 'missed';
  const label =
    status === 'ended'
      ? `${Kind} · ${callDurationLabel(m.durationMs)}`
      : status === 'missed'
        ? m.mine
          ? `${Kind} · No answer`
          : `Missed ${kind === 'video' ? 'video' : 'voice'} call`
        : `${Kind} · Declined`;
  const color = missedForMe ? T.rose : T.muted;
  const Icon = missedForMe ? PhoneMissed : kind === 'video' ? Video : Phone;
  return (
    <Pressable
      onPress={() => onCall?.(kind)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to call back`}
      style={({ pressed }) => ({
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: missedForMe ? `${T.rose}55` : T.border,
        backgroundColor: T.surface2,
        opacity: pressed ? 0.75 : 1,
      })}>
      <Icon size={13} color={color} />
      <Txt size={12} color={missedForMe ? T.rose : T.text} w={600}>
        {label}
      </Txt>
      <Txt v="mono" size={10} color={T.mutedDim}>
        {fmtTime(m.at)}
      </Txt>
    </Pressable>
  );
}

function MessageRow({ m, onCall }: { m: Msg; onCall?: (kind: CallKind) => void }) {
  if (m.type === 'call') return <CallPill m={m} onCall={onCall} />;
  return (
    <View>
      <Bubble m={m} />
      <Receipt m={m} />
    </View>
  );
}

function Bubble({ m }: { m: Msg }) {
  const radius = { borderRadius: 18, borderBottomRightRadius: m.mine ? 4 : 18, borderBottomLeftRadius: m.mine ? 18 : 4 };
  if (m.type === 'image') {
    if (m.real) return <ImageBubble path={m.mediaPath} uri={m.localUri} mine={m.mine} pending={m.pending} />;
    return <Image source={{ uri: m.image ?? undefined }} style={{ width: 180, height: 180, borderRadius: 16, alignSelf: m.mine ? 'flex-end' : 'flex-start', backgroundColor: T.surface3 }} />;
  }
  if (m.type === 'voice') {
    if (m.real) return <VoiceBubble path={m.mediaPath} uri={m.localUri} mine={m.mine} durationMs={m.durationMs} waveform={m.waveform} pending={m.pending} />;
    return <StaticVoiceBubble mine={m.mine} duration={m.duration ?? '0:12'} />;
  }
  const inner = (
    <Txt size={13.5} color={m.mine ? '#fff' : T.text} lh={1.35}>
      {m.text}
    </Txt>
  );
  const pad = { paddingVertical: 10, paddingHorizontal: 14 };
  return m.mine ? (
    <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ alignSelf: 'flex-end', maxWidth: '78%' }, radius, pad]}>
      {inner}
    </LinearGradient>
  ) : (
    <View style={[{ alignSelf: 'flex-start', maxWidth: '78%', backgroundColor: T.surface2 }, radius, pad]}>{inner}</View>
  );
}

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const isDemo = !!conversationId?.startsWith('demo-');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const { me, toast, removePerson, clearInboxFor } = useApp();
  const { placeCall } = useCalls();
  const [peer, setPeer] = useState<Peer | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannel = useRef<{ ping: () => void; leave: () => void } | null>(null);

  /* ---------- demo conversation (prototype ChatView, local only) ---------- */
  useEffect(() => {
    if (!isDemo) return;
    const p = PROFILES.find((x) => x.id === conversationId);
    if (!p) return;
    setPeer({
      id: p.id,
      name: p.name,
      photo: p.photo,
      online: p.online,
      match: p.match,
      icebreakers: [
        `Ask ${p.name} about their love of ${p.tags[3]?.toLowerCase() || 'travel'}.`,
        `You both picked ${p.intention.toLowerCase()} — ask what that looks like for them.`,
      ],
    });
    const n = Number(p.id.replace('demo-', ''));
    setMessages([
      { id: 'd1', mine: false, type: 'text', text: `Hey! I saw we're both into ${p.tags[0]?.toLowerCase()} 🎵` },
      { id: 'd2', mine: true, type: 'text', text: 'Right?! Been obsessed lately, what have you been listening to?' },
      { id: 'd3', mine: false, type: 'text', text: CHAT_PREVIEWS[n % CHAT_PREVIEWS.length] },
    ]);
  }, [isDemo, conversationId]);

  /* ---------- real conversation (Supabase + Realtime) ---------- */
  const toMsg = useCallback(
    (m: ChatMessage): Msg => ({
      id: m.id,
      mine: m.sender_id === user?.id,
      type: m.type === 'image' || m.type === 'voice' || m.type === 'call' ? m.type : 'text',
      text: m.content,
      mediaPath: m.media_path ?? null,
      durationMs: m.duration_ms ?? null,
      waveform: Array.isArray(m.waveform) ? m.waveform : null,
      real: true,
      at: m.created_at,
      readAt: m.read_at,
    }),
    [user?.id]
  );

  useEffect(() => {
    if (isDemo || !conversationId || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [meta, msgs] = await Promise.all([fetchConversationMeta(conversationId, user.id), fetchMessages(conversationId)]);
        if (cancelled) return;
        setMessages(msgs.map(toMsg));
        if (meta) {
          const labels = await fetchInterestLabelsForUsers([meta.otherUserId]).catch(() => ({}) as Record<string, string[]>);
          const theirs = labels[meta.otherUserId] ?? [];
          const c = computeCompat({ id: user.id, interests: me?.interests ?? [], intention: profile?.intention ?? null }, { id: meta.otherUserId, interests: theirs, intention: meta.otherIntention });
          const topic = c.shared[0] || theirs[0];
          const same = !!meta.otherIntention && meta.otherIntention === profile?.intention;
          if (!cancelled)
            setPeer({
              id: meta.otherUserId,
              name: meta.otherName,
              photo: meta.otherPhoto,
              online: false,
              match: c.overall,
              icebreakers: [
                topic ? `Ask ${meta.otherName} about their love of ${topic.toLowerCase()}.` : `Ask ${meta.otherName} about the last concert they loved.`,
                same
                  ? `You both picked ${intentionLabel(meta.otherIntention).toLowerCase()} — ask what that looks like for them.`
                  : `Ask ${meta.otherName} what a perfect Friday night looks like.`,
              ],
            });
        }
      } catch (err) {
        if (!cancelled) setError(friendlyError(err, 'Failed to load chat'));
      }
    })();
    const unsub = subscribeToMessages(
      conversationId,
      (m) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, toMsg(m)]));
        if (m.sender_id !== user.id) {
          setTyping(false);
          markReadSoon();
        }
      },
      // read_at stamped by the other side's mark_conversation_read → ✓✓
      (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, readAt: m.read_at } : x)))
    );
    markReadSoon();
    typingChannel.current = joinTypingChannel(conversationId, user.id, () => {
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 3000);
    });
    return () => {
      cancelled = true;
      unsub();
      typingChannel.current?.leave();
      typingChannel.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, conversationId, user?.id]);

  /* ---------- read receipts: mark read while this chat is on screen ---------- */
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadSoon = useCallback(() => {
    if (isDemo || !conversationId) return;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      if (AppState.currentState !== 'active') return;
      markConversationRead(conversationId)
        .then(() => clearInboxFor(conversationId))
        .catch((e) => console.warn('[match] mark read failed', e));
    }, 400);
  }, [isDemo, conversationId, clearInboxFor]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && markReadSoon());
    return () => {
      sub.remove();
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [markReadSoon]);

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, typing]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (isDemo) {
      setMessages((m) => [...m, { id: `me-${Date.now()}`, mine: true, type: 'text', text }]);
      setInput('');
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        setMessages((m) => [...m, { id: `them-${Date.now()}`, mine: false, type: 'text', text: "That's really sweet, tell me more 😊" }]);
      }, 1100);
      return;
    }
    if (!user?.id || !conversationId) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendMessage(conversationId, user.id, text);
      setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, toMsg(msg)]));
      setInput('');
      void pushLatestNotification(peer?.id);
    } catch (err) {
      setError(friendlyError(err, 'Send failed'));
    } finally {
      setSending(false);
    }
  };

  /** Optimistic bubble → upload → swap for the stored row (Realtime dedupes by id). */
  const sendMedia = async (media: Parameters<typeof sendMediaMessage>[2]) => {
    if (!user?.id || !conversationId) return;
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, mine: true, type: media.type, localUri: media.uri, durationMs: media.durationMs ?? null, waveform: media.waveform ?? null, pending: true, real: true },
    ]);
    setError(null);
    try {
      const msg = await sendMediaMessage(conversationId, user.id, media);
      setMessages((prev) => {
        const withoutTemp = prev.filter((x) => x.id !== tempId);
        if (withoutTemp.some((x) => x.id === msg.id)) return withoutTemp;
        return [...withoutTemp, { ...toMsg(msg), localUri: media.uri }];
      });
      void pushLatestNotification(peer?.id);
    } catch (err) {
      setMessages((prev) => prev.filter((x) => x.id !== tempId));
      toast(friendlyError(err, 'Upload failed'));
    }
  };

  const sendImage = async () => {
    if (isDemo) {
      const n = Number(conversationId.replace('demo-', ''));
      setMessages((m) => [...m, { id: `img-${Date.now()}`, mine: true, type: 'image', image: avatar(((n * 5) % 70) + 1, 400) }]);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast('Allow photo access to send pictures');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    const mime = asset.mimeType && !/heic|heif/i.test(asset.mimeType) ? asset.mimeType : 'image/jpeg';
    void sendMedia({ type: 'image', uri: asset.uri, mime });
  };

  const voice = useVoiceRecorder();
  const [voiceSending, setVoiceSending] = useState(false);
  const sendVoice = async () => {
    if (isDemo) {
      setMessages((m) => [...m, { id: `v-${Date.now()}`, mine: true, type: 'voice', duration: `0:${String(8 + Math.floor(Math.random() * 27)).padStart(2, '0')}` }]);
      return;
    }
    try {
      const ok = await voice.start();
      if (!ok) toast('Allow microphone access to record voice notes');
    } catch (err) {
      toast(friendlyError(err, 'Could not start recording'));
    }
  };
  const finishVoice = async () => {
    setVoiceSending(true);
    try {
      const clip = await voice.stop();
      if (!clip) return toast('Hold on a little longer — that was too short');
      void sendMedia({ type: 'voice', uri: clip.uri, mime: 'audio/m4a', durationMs: clip.durationMs, waveform: clip.waveform });
    } catch (err) {
      toast(friendlyError(err, 'Recording failed'));
    } finally {
      setVoiceSending(false);
    }
  };
  useEffect(() => {
    if (voice.active && voice.maxReached) void finishVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.maxReached, voice.active]);
  useEffect(
    () => () => {
      void voice.cancel();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const call = useCallback(
    (kind: CallKind) => {
      if (isDemo) return toast('Calls work with your real matches');
      if (!peer || !conversationId) return;
      void placeCall(conversationId, { id: peer.id, name: peer.name, photo: peer.photo }, kind);
    },
    [isDemo, peer, conversationId, placeCall, toast]
  );

  const header = useMemo(
    () => (
      <View style={{ paddingHorizontal: 4 }}>
        <View style={{ marginTop: 12, marginBottom: 6, paddingVertical: 12, paddingHorizontal: 4, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 16 }}>
          <Txt v="mono" size={10} color={T.amber} style={{ letterSpacing: 1, paddingHorizontal: 10, marginBottom: 6 }}>
            QUESTIONS YOU HAVE IN COMMON
          </Txt>
          {(peer?.icebreakers ?? []).map((q) => (
            <Pressable key={q} onPress={() => setInput(q)} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
              <Txt size={12.5}>💬 {q}</Txt>
            </Pressable>
          ))}
        </View>
        {error ? (
          <Txt size={12} color={T.rose} style={{ marginTop: 6 }}>
            {error}
          </Txt>
        ) : null}
      </View>
    ),
    [peer?.icebreakers, error]
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Backdrop />
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 18, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: T.border }}>
          <IconBtn onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/messages'))}>
            <ArrowLeft size={17} color={T.text} />
          </IconBtn>
          <Avatar uri={peer?.photo} name={peer?.name} size={38} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt w={700} size={14}>
                {peer?.name ?? ' '}
              </Txt>
              {isDemo ? <DemoTag /> : null}
            </View>
            <Txt size={11} color={peer?.online ? T.mint : T.mutedDim}>
              {typing ? 'typing…' : peer?.online ? 'Online now' : 'Active recently'}
            </Txt>
          </View>
          {peer?.match != null ? (
            <View style={{ backgroundColor: T.surface2, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 }}>
              <Txt v="mono" size={11}>
                {peer.match}% 🔥
              </Txt>
            </View>
          ) : null}
          {!isDemo ? (
            <>
              <IconBtn size={32} label="Voice call" onPress={() => call('audio')}>
                <Phone size={15} color={T.text} />
              </IconBtn>
              <IconBtn size={32} label="Video call" onPress={() => call('video')}>
                <Video size={16} color={T.text} />
              </IconBtn>
            </>
          ) : null}
          {!isDemo ? (
            <IconBtn size={32} onPress={() => setSafetyOpen(true)}>
              <MoreHorizontal size={16} color={T.text} />
            </IconBtn>
          ) : null}
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingVertical: 6, paddingHorizontal: 4, gap: 8 }}
          renderItem={({ item }) => <MessageRow m={item} onCall={call} />}
          ListFooterComponent={typing ? <TypingDots /> : null}
          ListEmptyComponent={
            <Txt size={13} color={T.mutedDim} center style={{ marginTop: 30 }}>
              You matched! Say hi 👋
            </Txt>
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        <View style={{ flexDirection: 'row', gap: 8, paddingTop: 10, paddingHorizontal: 4, paddingBottom: Math.max(insets.bottom, 12), alignItems: 'center' }}>
          {voice.active ? (
            <RecordingBar durationMs={voice.durationMs} levels={voice.levels} sending={voiceSending} onCancel={() => void voice.cancel()} onSend={finishVoice} />
          ) : (
            <>
              <IconBtn onPress={sendImage}>
                <ImageIcon size={16} color={T.text} />
              </IconBtn>
              <IconBtn onPress={sendVoice}>
                <Mic size={16} color={T.text} />
              </IconBtn>
              <TextInput
                value={input}
                onChangeText={(v) => {
                  setInput(v);
                  typingChannel.current?.ping();
                }}
                onSubmitEditing={send}
                returnKeyType="send"
                placeholder="Type a message…"
                placeholderTextColor={T.mutedDim}
                style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2, color: T.text, fontSize: 13.5, ...body(400) }}
              />
              <Pressable onPress={send} disabled={sending} style={{ opacity: sending ? 0.6 : 1 }}>
                <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
                  <Send size={16} color="#fff" />
                </LinearGradient>
              </Pressable>
            </>
          )}
        </View>
      </View>

      <SafetySheet
        person={safetyOpen && peer ? { name: peer.name } : null}
        onClose={() => setSafetyOpen(false)}
        onBlock={async () => {
          if (!user?.id || !peer) return;
          try {
            await blockUser(user.id, peer.id);
            removePerson(peer.id);
            setSafetyOpen(false);
            toast(`${peer.name} blocked`);
            router.back();
          } catch (err) {
            toast(friendlyError(err, 'Block failed'));
          }
        }}
        onReport={async (category, details) => {
          if (!user?.id || !peer) return;
          try {
            await reportUser({ reporterId: user.id, reportedId: peer.id, category, details });
            setSafetyOpen(false);
            toast('Report submitted — thank you');
          } catch (err) {
            toast(friendlyError(err, 'Report failed'));
          }
        }}
      />
    </KeyboardAvoidingView>
  );
}
