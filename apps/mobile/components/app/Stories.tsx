import { LinearGradient } from 'expo-linear-gradient';
import { Camera, Heart, MessageCircle, Send, Sparkles, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { avatar, type StoryFrame, type StoryUser } from '@/lib/mock';

import { inputStyle } from './AuthForm';

const DURATION = 4500;

export function StoryViewer({
  users,
  startIndex,
  onClose,
  onViewed,
  toast,
}: {
  users: StoryUser[];
  startIndex: number | null;
  onClose: () => void;
  onViewed: (id: string) => void;
  toast: (m: string) => void;
}) {
  return (
    <Modal visible={startIndex !== null} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {startIndex !== null ? <Viewer users={users} startIndex={startIndex} onClose={onClose} onViewed={onViewed} toast={toast} /> : null}
    </Modal>
  );
}

function Viewer({ users, startIndex, onClose, onViewed, toast }: { users: StoryUser[]; startIndex: number; onClose: () => void; onViewed: (id: string) => void; toast: (m: string) => void }) {
  const insets = useSafeAreaInsets();
  const [userIdx, setUserIdx] = useState(startIndex);
  const [frameIdx, setFrameIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [voted, setVoted] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const user = users[userIdx];
  const frame: StoryFrame | undefined = user?.frames?.[frameIdx];

  useEffect(() => {
    if (user) onViewed(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdx]);

  const nextFrame = () => {
    if (!user) return;
    setVoted(null);
    if (frameIdx < user.frames.length - 1) setFrameIdx((f) => f + 1);
    else if (userIdx < users.length - 1) {
      setUserIdx((u) => u + 1);
      setFrameIdx(0);
    } else onClose();
  };
  const prevFrame = () => {
    setVoted(null);
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

  const sendReply = () => {
    if (!reply.trim()) return;
    toast(`Reply sent to ${user.name} 💬`);
    setReply('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {frame.type === 'photo' ? (
        <Image source={{ uri: frame.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
          2h
        </Txt>
        <View style={{ flex: 1 }} />
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
                {frame.options.map((o) => (
                  <Pressable
                    key={o}
                    onPress={() => {
                      setVoted(o);
                      toast(`Voted "${o}"`);
                    }}
                    style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: voted === o ? '#fff' : 'rgba(255,255,255,0.6)', backgroundColor: voted === o ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)', alignItems: 'center' }}>
                    <Txt w={700} size={13} color="#fff">
                      {o}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              onSubmitEditing={sendReply}
              placeholder={`Reply to ${user.name}…`}
              placeholderTextColor="rgba(255,255,255,0.7)"
              style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 13, ...body(400) }}
            />
            <Pressable onPress={sendReply} style={styles.round}>
              <Send size={16} color="#fff" />
            </Pressable>
            <Pressable onPress={() => toast(`You liked ${user.name}'s story ❤️`)} style={styles.round}>
              <Heart size={17} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export function CreateStorySheet({ visible, onClose, onCreate }: { visible: boolean; onClose: () => void; onCreate: (f: StoryFrame) => void }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<StoryFrame['type'] | null>(null);
  const options = [
    { type: 'photo' as const, label: 'Photo', Icon: Camera },
    { type: 'question' as const, label: 'Question', Icon: MessageCircle },
    { type: 'poll' as const, label: 'Poll', Icon: Sparkles },
  ];
  const create = () => {
    if (picked === 'photo') onCreate({ type: 'photo', image: avatar(66, 600), caption: text || 'New moment ✨' });
    else if (picked === 'question') onCreate({ type: 'question', question: text || 'Ask me anything!', bg: [T.violet, T.rose] });
    else if (picked === 'poll') onCreate({ type: 'poll', question: text || 'This or that?', options: ['Option A', 'Option B'], bg: [T.amber, T.rose] });
    setText('');
    setPicked(null);
  };
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Add to your story">
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
        {options.map(({ type, label, Icon }) => (
          <Pressable key={type} onPress={() => setPicked(type)} style={{ flex: 1, paddingVertical: 16, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, borderColor: picked === type ? T.rose : T.border, backgroundColor: picked === type ? `${T.rose}22` : T.surface2 }}>
            <Icon size={20} color={T.text} style={{ marginBottom: 6 }} />
            <Txt w={600} size={11.5}>
              {label}
            </Txt>
          </Pressable>
        ))}
      </View>
      {picked ? (
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={picked === 'photo' ? 'Add a caption…' : picked === 'question' ? 'What do you want to ask?' : 'This or that?'}
          placeholderTextColor={T.mutedDim}
          style={[inputStyle, { fontSize: 13.5, paddingVertical: 14, borderRadius: 14, marginBottom: 16 }]}
        />
      ) : null}
      <PrimaryButton label="Share to story" disabled={!picked} onPress={create} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
});
