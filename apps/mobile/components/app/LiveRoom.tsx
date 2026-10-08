import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Radio, Send, Users, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/ui/Sheet';
import { Avatar, Chip, IconBtn, LiveBadge, MatchRing, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { LIVE_CATS, LIVE_CHAT, type LiveRoom } from '@/lib/mock';

import { inputStyle } from './AuthForm';

export function LiveRoomView({ room, onClose }: { room: LiveRoom | null; onClose: () => void }) {
  return (
    <Modal visible={!!room} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {room ? <Room room={room} onClose={onClose} /> : null}
    </Modal>
  );
}

function Room({ room, onClose }: { room: LiveRoom; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [reactions, setReactions] = useState(0);
  const [votes, setVotes] = useState({ yes: 61, no: 39 });
  const [chatLog, setChatLog] = useState<{ user: string; text: string; you?: boolean }[]>(LIVE_CHAT);
  const [chatInput, setChatInput] = useState('');
  const [viewers, setViewers] = useState(room.viewers);

  useEffect(() => {
    if (!room.isSelf) return;
    const t = setInterval(() => setViewers((v) => v + 1 + Math.floor(Math.random() * 6)), 1800);
    return () => clearInterval(t);
  }, [room.isSelf]);

  const sendChat = () => {
    if (!chatInput.trim()) return;
    setChatLog((c) => [...c, { user: 'You', text: chatInput, you: true }]);
    setChatInput('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.ink }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {room.cover ? <Image source={{ uri: room.cover }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} resizeMode="cover" /> : null}
      <LinearGradient colors={['rgba(10,8,14,0.5)', 'rgba(10,8,14,0.2)', 'rgba(10,8,14,0.9)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />

      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBtn onPress={onClose}>
          <X size={17} color={T.text} />
        </IconBtn>
        <LiveBadge size={10.5} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Users size={13} color="#fff" />
          <Txt size={12} color="#fff">
            {viewers}
          </Txt>
        </View>
        <View style={{ flex: 1 }} />
        {room.host ? <Avatar uri={room.host.photo} name={room.host.name} size={32} ring={T.rose} /> : null}
        {room.guest ? <Avatar uri={room.guest.photo} name={room.guest.name} size={32} ring={T.violet} style={{ marginLeft: -14 }} /> : null}
      </View>

      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
        <Txt v="display" size={20} color="#fff" style={{ marginBottom: 4 }}>
          {room.title}
        </Txt>
        {room.isSelf ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Radio size={13} color={T.mint} />
            <Txt size={12} color={T.mint}>
              You're live — viewers are joining
            </Txt>
          </View>
        ) : null}

        {room.liveMatch ? (
          <View style={{ backgroundColor: 'rgba(30,25,40,0.75)', borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 16, marginVertical: 10 }}>
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <MatchRing percent={78} size={70} />
            </View>
            <Txt size={12.5} color={T.muted} center style={{ marginBottom: 12 }}>
              Should {room.host?.name} & {room.guest?.name} match?
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setVotes((v) => ({ ...v, yes: v.yes + 1 }))} style={{ flex: 1 }}>
                <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ padding: 10, borderRadius: 12, alignItems: 'center' }}>
                  <Txt w={700} color="#fff">
                    ❤️ Yes {votes.yes}%
                  </Txt>
                </LinearGradient>
              </Pressable>
              <Pressable onPress={() => setVotes((v) => ({ ...v, no: v.no + 1 }))} style={{ flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: T.border, alignItems: 'center' }}>
                <Txt w={700} color="#fff">
                  No {votes.no}%
                </Txt>
              </Pressable>
            </View>
          </View>
        ) : null}

        <ScrollView style={{ maxHeight: 130, marginBottom: 14 }} contentContainerStyle={{ gap: 6 }}>
          {chatLog.map((c, i) => (
            <Txt key={i} size={12.5} color="#EDE7F5">
              <Txt w={700} size={12.5} color={c.you ? T.mint : T.amber}>
                {c.user}
              </Txt>{' '}
              {c.text}
            </Txt>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={chatInput}
            onChangeText={setChatInput}
            onSubmitEditing={sendChat}
            placeholder="Say something…"
            placeholderTextColor={T.muted}
            style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: 'rgba(38,32,47,0.8)', color: '#fff', fontSize: 13, ...body(400) }}
          />
          <Pressable onPress={sendChat} style={styles.roundGlass}>
            <Send size={16} color="#fff" />
          </Pressable>
          <Pressable onPress={() => setReactions((r) => r + 1)} style={[styles.roundGlass, { backgroundColor: T.rose }]}>
            <Heart size={18} color="#fff" fill="#fff" />
            {reactions > 0 ? (
              <View style={{ position: 'absolute', top: -6, right: -6, backgroundColor: T.amber, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Txt w={700} size={9} color="#1a1a1a">
                  {reactions}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export function GoLiveSheet({ visible, onClose, onStart }: { visible: boolean; onClose: () => void; onStart: (title: string, category: string) => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Talk');
  return (
    <Sheet visible={visible} onClose={onClose} scrim={T.scrimDeep} title="Go Live" icon={<Radio size={17} color={T.rose} />}>
      <Txt size={12.5} color={T.muted} style={{ marginTop: -10, marginBottom: 18 }}>
        Set a title and category — you can start whenever you're ready.
      </Txt>
      <TextInput value={title} onChangeText={setTitle} placeholder="What's this live about?" placeholderTextColor={T.mutedDim} style={[inputStyle, { fontSize: 13.5, paddingVertical: 14, borderRadius: 14, marginBottom: 14 }]} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {LIVE_CATS.filter((c) => c !== 'Trending').map((c) => (
          <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      <PrimaryButton label="Start streaming" onPress={() => onStart(title || 'Untitled live', category)} />
      <TextButton label="Cancel" onPress={onClose} size={13} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  roundGlass: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
