import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, Eye, Heart, MessageCircle, Send, Sparkles, Trash2, Type, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { timeAgo } from '@/lib/inbox';
import { type StoryFrame, type StoryUser } from '@/lib/mock';
import { pushLatestNotification } from '@/lib/push';
import { deleteStory, fetchMyVote, fetchPollCounts, fetchStoryStats, markStoryViewed, respondToStory, type NewStory } from '@/lib/stories';

import { inputStyle } from './AuthForm';

const DURATION = 4500;

export function StoryViewer({
  users,
  startIndex,
  onClose,
  onViewed,
  toast,
  meId,
  onDeleted,
}: {
  users: StoryUser[];
  startIndex: number | null;
  onClose: () => void;
  onViewed: (id: string) => void;
  toast: (m: string) => void;
  meId?: string | null;
  onDeleted?: () => void;
}) {
  return (
    <Modal visible={startIndex !== null} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {startIndex !== null ? <Viewer users={users} startIndex={startIndex} onClose={onClose} onViewed={onViewed} toast={toast} meId={meId ?? null} onDeleted={onDeleted} /> : null}
    </Modal>
  );
}

function Viewer({
  users,
  startIndex,
  onClose,
  onViewed,
  toast,
  meId,
  onDeleted,
}: {
  users: StoryUser[];
  startIndex: number;
  onClose: () => void;
  onViewed: (id: string) => void;
  toast: (m: string) => void;
  meId: string | null;
  onDeleted?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [userIdx, setUserIdx] = useState(startIndex);
  const [frameIdx, setFrameIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [voted, setVoted] = useState<number | null>(null);
  const [counts, setCounts] = useState<number[] | null>(null);
  const [stats, setStats] = useState<{ views: number; replies: number } | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const user = users[userIdx];
  const frame: StoryFrame | undefined = user?.frames?.[frameIdx];
  const real = !!user?.real && !!frame?.id && !!meId;
  const own = !!user?.isMe;

  useEffect(() => {
    if (user) onViewed(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdx]);

  // Real frames: record the view, load poll state / owner stats.
  useEffect(() => {
    setVoted(null);
    setCounts(null);
    setStats(null);
    if (!real || !frame?.id || !meId) return;
    let alive = true;
    if (!own) void markStoryViewed(frame.id, meId);
    if (frame.type === 'poll') {
      const n = frame.options.length;
      void Promise.all([own ? Promise.resolve(null) : fetchMyVote(frame.id, meId), fetchPollCounts(frame.id, n)]).then(([mine, c]) => {
        if (!alive) return;
        setVoted(mine);
        if (mine !== null || own) setCounts(c);
      });
    }
    if (own) void fetchStoryStats(frame.id).then((s) => alive && setStats(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.id, real, own]);

  const nextFrame = () => {
    if (!user) return;
    if (frameIdx < user.frames.length - 1) setFrameIdx((f) => f + 1);
    else if (userIdx < users.length - 1) {
      setUserIdx((u) => u + 1);
      setFrameIdx(0);
    } else onClose();
  };
  const prevFrame = () => {
    if (frameIdx > 0) setFrameIdx((f) => f - 1);
    else if (userIdx > 0) {
      setUserIdx((u) => u - 1);
      setFrameIdx(0);
    }
  };
  const nextRef = useRef(nextFrame);
  nextRef.current = nextFrame;

  useEffect(() => {
    progress.setValue(0);
  }, [userIdx, frameIdx, progress]);

  useEffect(() => {
    if (paused) {
      progress.stopAnimation();
      return;
    }
    let done = false;
    progress.stopAnimation((v) => {
      const remaining = DURATION * (1 - (v || 0));
      Animated.timing(progress, { toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
        if (finished && !done) nextRef.current();
      });
    });
    return () => {
      done = true;
    };
  }, [userIdx, frameIdx, paused, progress]);

  if (!user || !frame) return null;

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setReply('');
    if (!real || !frame.id || !meId) {
      toast(`Reply sent to ${user.name} 💬`);
      return;
    }
    try {
      await respondToStory(frame.id, meId, { kind: frame.type === 'question' ? 'answer' : 'reply', body: text });
      void pushLatestNotification(user.id);
      toast(frame.type === 'question' ? `Answer sent to ${user.name} 💬` : `Reply sent to ${user.name} 💬`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Reply failed');
    }
  };

  const vote = async (i: number, label: string) => {
    if (frame.type !== 'poll' || voted !== null || own) return;
    setVoted(i);
    if (!real || !frame.id || !meId) {
      toast(`Voted "${label}"`);
      return;
    }
    try {
      const res = await respondToStory(frame.id, meId, { kind: 'vote', optionIndex: i });
      setCounts(await fetchPollCounts(frame.id, frame.options.length));
      toast(res === 'duplicate' ? 'You already voted' : `Voted "${label}"`);
    } catch (err) {
      setVoted(null);
      toast(err instanceof Error ? err.message : 'Vote failed');
    }
  };

  const like = async () => {
    if (!real || !frame.id || !meId) return toast(`You liked ${user.name}'s story ❤️`);
    try {
      const res = await respondToStory(frame.id, meId, { kind: 'like' });
      toast(res === 'duplicate' ? 'Already liked ❤️' : `You liked ${user.name}'s story ❤️`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Like failed');
    }
  };

  const remove = async () => {
    if (!own || !frame.id || !meId) return;
    try {
      await deleteStory(meId, frame.id);
      toast('Story deleted');
      onDeleted?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const total = counts ? counts.reduce((a, b) => a + b, 0) : 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {frame.type === 'photo' ? (
        frame.image ? (
          <Image source={{ uri: frame.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: T.surface2 }]} />
        )
      ) : (
        <LinearGradient colors={frame.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.75)']} locations={[0, 0.25, 0.65, 1]} style={StyleSheet.absoluteFill} />

      <View style={{ paddingTop: insets.top + 8, flexDirection: 'row', gap: 4, paddingHorizontal: 12 }}>
        {user.frames.map((_, i) => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
            <Animated.View
              style={{
                height: '100%',
                backgroundColor: '#fff',
                borderRadius: 3,
                width: i < frameIdx ? '100%' : i > frameIdx ? '0%' : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }}
            />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Avatar uri={user.photo} name={user.name} size={32} style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' }} />
        <Txt w={700} size={13.5} color="#fff">
          {user.name}
        </Txt>
        <Txt size={11} color="rgba(255,255,255,0.7)">
          {frame.createdAt ? timeAgo(frame.createdAt) : '2h'}
        </Txt>
        <View style={{ flex: 1 }} />
        {own && real ? (
          <Pressable onPress={remove} hitSlop={10} style={{ marginRight: 14 }}>
            <Trash2 size={18} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} hitSlop={10}>
          <X size={20} color="#fff" />
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <Pressable onPress={prevFrame} onPressIn={() => setPaused(true)} onPressOut={() => setPaused(false)} style={{ position: 'absolute', left: 0, top: 0, bottom: 90, width: '32%' }} />
        <Pressable onPress={nextFrame} onPressIn={() => setPaused(true)} onPressOut={() => setPaused(false)} style={{ position: 'absolute', right: 0, top: 0, bottom: 90, width: '68%' }} />

        <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: insets.bottom + 16 }}>
          {frame.type === 'photo' && frame.caption ? (
            <Txt w={600} size={15} color="#fff" style={{ marginBottom: 16, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 }}>
              {frame.caption}
            </Txt>
          ) : null}
          {frame.type === 'text' ? (
            <View pointerEvents="none" style={{ flex: 1, justifyContent: 'center', paddingBottom: 40 }}>
              <Txt v="display" size={28} color="#fff" center lh={1.25}>
                {frame.text}
              </Txt>
            </View>
          ) : null}
          {frame.type === 'question' ? (
            <View style={{ backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <Txt w={700} size={16} color="#fff" center>
                {frame.question}
              </Txt>
            </View>
          ) : null}
          {frame.type === 'poll' ? (
            <View style={{ marginBottom: 16 }}>
              <Txt w={700} size={16} color="#fff" center style={{ marginBottom: 12 }}>
                {frame.question}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {frame.options.map((o, i) => {
                  const pct = counts && total ? Math.round((counts[i] / total) * 100) : counts ? 0 : null;
                  return (
                    <Pressable
                      key={`${o}-${i}`}
                      onPress={() => vote(i, o)}
                      style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: voted === i ? '#fff' : 'rgba(255,255,255,0.6)', backgroundColor: voted === i ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)', alignItems: 'center', overflow: 'hidden' }}>
                      {pct !== null ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: 'rgba(255,255,255,0.18)' }} /> : null}
                      <Txt w={700} size={13} color="#fff">
                        {o}
                      </Txt>
                      {pct !== null ? (
                        <Txt v="mono" size={11} color="#fff" style={{ marginTop: 2, opacity: 0.9 }}>
                          {pct}%
                        </Txt>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              {own && counts ? (
                <Txt size={11.5} color="rgba(255,255,255,0.8)" center style={{ marginTop: 8 }}>
                  {total} {total === 1 ? 'vote' : 'votes'}
                </Txt>
              ) : null}
            </View>
          ) : null}

          {own ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}>
              <Eye size={15} color="#fff" />
              <Txt w={600} size={12.5} color="#fff">
                {stats ? `${stats.views} ${stats.views === 1 ? 'view' : 'views'} · ${stats.replies} ${stats.replies === 1 ? 'reply' : 'replies'}` : real ? '…' : 'Your story'}
              </Txt>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                value={reply}
                onChangeText={setReply}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                onSubmitEditing={sendReply}
                placeholder={frame.type === 'question' ? `Answer ${user.name}…` : `Reply to ${user.name}…`}
                placeholderTextColor="rgba(255,255,255,0.7)"
                style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 13, ...body(400) }}
              />
              <Pressable onPress={sendReply} style={styles.round}>
                <Send size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={like} style={styles.round}>
                <Heart size={17} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

type Kind = NewStory['type'];

export function CreateStorySheet({ visible, onClose, onCreate }: { visible: boolean; onClose: () => void; onCreate: (s: NewStory) => Promise<void> | void }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Kind | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; mime: string } | null>(null);
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setText('');
      setPicked(null);
      setPhoto(null);
      setOptA('');
      setOptB('');
      setBusy(false);
    }
  }, [visible]);

  const options = [
    { type: 'photo' as const, label: 'Photo', Icon: Camera },
    { type: 'text' as const, label: 'Text', Icon: Type },
    { type: 'question' as const, label: 'Question', Icon: MessageCircle },
    { type: 'poll' as const, label: 'Poll', Icon: Sparkles },
  ];

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75, allowsEditing: true, aspect: [9, 16] });
    const asset = result.canceled ? null : result.assets?.[0];
    if (asset) setPhoto({ uri: asset.uri, mime: asset.mimeType || 'image/jpeg' });
  };

  const choose = (type: Kind) => {
    setPicked(type);
    if (type === 'photo' && !photo) void pickPhoto();
  };

  const ready = picked === 'photo' ? !!photo : picked === 'text' ? !!text.trim() : !!picked;

  const create = async () => {
    if (!picked || busy) return;
    let story: NewStory;
    if (picked === 'photo') {
      if (!photo) return;
      story = { type: 'photo', uri: photo.uri, mime: photo.mime, caption: text.trim() || undefined };
    } else if (picked === 'text') story = { type: 'text', text: text.trim() };
    else if (picked === 'question') story = { type: 'question', question: text.trim() || 'Ask me anything!' };
    else story = { type: 'poll', question: text.trim() || 'This or that?', options: [optA.trim() || 'Option A', optB.trim() || 'Option B'] };
    setBusy(true);
    try {
      await onCreate(story);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Add to your story">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        {options.map(({ type, label, Icon }) => (
          <Pressable key={type} onPress={() => choose(type)} style={{ flex: 1, paddingVertical: 16, paddingHorizontal: 4, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, borderColor: picked === type ? T.rose : T.border, backgroundColor: picked === type ? `${T.rose}22` : T.surface2 }}>
            <Icon size={20} color={T.text} style={{ marginBottom: 6 }} />
            <Txt w={600} size={11.5}>
              {label}
            </Txt>
          </Pressable>
        ))}
      </View>
      {picked === 'photo' ? (
        <Pressable onPress={pickPhoto} style={{ height: 150, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderStyle: photo ? 'solid' : 'dashed', borderColor: photo ? T.border : `${T.rose}88`, backgroundColor: `${T.rose}11`, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          {photo ? <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          {!photo ? (
            <Txt w={600} size={12.5} color={T.rose}>
              Choose a photo
            </Txt>
          ) : null}
        </Pressable>
      ) : null}
      {picked ? (
        <TextInput
          value={text}
          onChangeText={setText}
          maxLength={picked === 'photo' ? 200 : 280}
          placeholder={picked === 'photo' ? 'Add a caption…' : picked === 'text' ? 'Say something…' : picked === 'question' ? 'What do you want to ask?' : 'This or that?'}
          placeholderTextColor={T.mutedDim}
          style={[inputStyle, { fontSize: 13.5, paddingVertical: 14, borderRadius: 14, marginBottom: picked === 'poll' ? 10 : 16 }]}
        />
      ) : null}
      {picked === 'poll' ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <TextInput value={optA} onChangeText={setOptA} maxLength={40} placeholder="Option A" placeholderTextColor={T.mutedDim} style={[inputStyle, { flex: 1, fontSize: 13, paddingVertical: 12, borderRadius: 14 }]} />
          <TextInput value={optB} onChangeText={setOptB} maxLength={40} placeholder="Option B" placeholderTextColor={T.mutedDim} style={[inputStyle, { flex: 1, fontSize: 13, paddingVertical: 12, borderRadius: 14 }]} />
        </View>
      ) : null}
      <PrimaryButton label={busy ? 'Sharing…' : 'Share to story'} disabled={!ready || busy} loading={busy} onPress={create} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
});
