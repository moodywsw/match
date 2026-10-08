import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Radio, Users } from 'lucide-react-native';

import { GoLiveSheet, LiveRoomView } from '@/components/app/LiveRoom';
import { Screen } from '@/components/app/Screen';
import { DarkPill, FadeUp, LiveBadge, Photo } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { fetchLiveStreams } from '@/lib/explore';
import { LIVE_CAT_LABEL, LIVE_CATS, LIVE_ROOMS, type LiveRoom } from '@/lib/mock';

export default function LiveTab() {
  const { me } = useApp();
  const [cat, setCat] = useState('Trending');
  const [showGoLive, setShowGoLive] = useState(false);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [realRooms, setRealRooms] = useState<LiveRoom[]>([]);

  useEffect(() => {
    fetchLiveStreams()
      .then((rows) =>
        setRealRooms(
          rows.map((r) => ({ id: r.id, title: r.title, category: r.category, viewers: 1, cover: null, host: { name: r.hostName || 'Host', photo: null }, liveMatch: r.is_live_match }))
        )
      )
      .catch(() => setRealRooms([]));
  }, []);

  const all = [...realRooms, ...LIVE_ROOMS];
  const filtered = cat === 'Trending' ? all : all.filter((r) => r.category === cat);

  return (
    <Screen>
      <FadeUp>
        <Txt v="display" size={22} style={{ marginBottom: 4 }}>
          Live
        </Txt>
        <Txt size={13} color={T.muted} style={{ marginBottom: 14 }}>
          Jump into a room, or start your own.
        </Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18 }}>
          {LIVE_CATS.map((c) => (
            <Pressable key={c} onPress={() => setCat(c)} style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: cat === c ? T.rose : T.border, backgroundColor: cat === c ? `${T.rose}22` : 'transparent' }}>
              <Txt w={600} size={12.5} color={cat === c ? '#fff' : T.muted}>
                {LIVE_CAT_LABEL[c]}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable onPress={() => setShowGoLive(true)} style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: `${T.rose}88`, backgroundColor: `${T.rose}11`, marginBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Radio size={16} color={T.rose} />
          <Txt w={700} size={13.5} color={T.rose}>
            Go Live
          </Txt>
        </Pressable>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {filtered.map((r) => (
            <Pressable key={r.id} onPress={() => setRoom(r)} style={{ width: '47.8%', borderWidth: 1, borderColor: r.liveMatch ? T.violet : T.border, borderRadius: 18, overflow: 'hidden', backgroundColor: T.surface }}>
              <View style={{ height: 130 }}>
                <Photo uri={r.cover} name={r.title} style={{ width: '100%', height: '100%' }} />
                <View style={{ position: 'absolute', top: 8, left: 8 }}>
                  <LiveBadge />
                </View>
                <DarkPill style={{ position: 'absolute', top: 8, right: 8, borderRadius: 6 }}>
                  <Users size={10} color={T.text} />
                  <Txt size={10}>{r.viewers}</Txt>
                </DarkPill>
                {r.liveMatch ? (
                  <View style={{ position: 'absolute', bottom: 8, left: 8, backgroundColor: T.violet, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8 }}>
                    <Txt w={700} size={10.5} color="#fff">
                      💘 LIVE MATCH
                    </Txt>
                  </View>
                ) : null}
              </View>
              <View style={{ paddingVertical: 9, paddingHorizontal: 10 }}>
                <Txt w={700} size={12} numberOfLines={1}>
                  {r.title}
                </Txt>
                <Txt size={10.5} color={T.muted} style={{ marginTop: 3 }}>
                  {r.host?.name}
                  {r.guest ? ` & ${r.guest.name}` : ''}
                </Txt>
              </View>
            </Pressable>
          ))}
        </View>
      </FadeUp>

      <GoLiveSheet
        visible={showGoLive}
        onClose={() => setShowGoLive(false)}
        onStart={(title, category) => {
          setShowGoLive(false);
          setTimeout(() => setRoom({ id: 'you', title, category, host: { name: 'You', photo: me?.photo ?? null }, cover: me?.photo ?? null, viewers: 1, isSelf: true }), 350);
        }}
      />
      <LiveRoomView room={room} onClose={() => setRoom(null)} />
    </Screen>
  );
}
