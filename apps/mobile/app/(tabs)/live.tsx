import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Coins, Radio, Users } from 'lucide-react-native';

import { RoomTypeBadge } from '@/components/app/LiveDating';
import { GoLiveSheet, LiveRoomView } from '@/components/app/LiveRoom';
import { Screen } from '@/components/app/Screen';
import { DarkPill, FadeUp, LiveBadge, Photo } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLiveRooms } from '@/hooks/useLiveRooms';
import { fetchLiveEligibility, liveErrorMessage, startLive, type LiveEligibility } from '@/lib/live';
import { LIVE_CAT_LABEL, LIVE_CATS, type LiveRoom } from '@/lib/mock';
import { fetchWallet, fmtCoins } from '@/lib/wallet';

export default function LiveTab() {
  const { me } = useApp();
  const [cat, setCat] = useState('Trending');
  const [showGoLive, setShowGoLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const { rooms: filtered, reload } = useLiveRooms(cat);
  const router = useRouter();
  const [elig, setElig] = useState<LiveEligibility | null>(null);
  const { user } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      fetchLiveEligibility()
        .then(setElig)
        .catch(() => setElig(null));
      if (user?.id)
        fetchWallet(user.id)
          .then((w) => setCoins(w.coins))
          .catch(() => {});
    }, [user?.id])
  );

  return (
    <Screen>
      <FadeUp>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Txt v="display" size={22} style={{ flex: 1 }}>
            Live
          </Txt>
          <Pressable
            onPress={() => router.push('/wallet')}
            accessibilityRole="button"
            accessibilityLabel={`Wallet, ${coins ?? 0} coins`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: `${T.amber}1F`, borderWidth: 1, borderColor: `${T.amber}55`, opacity: pressed ? 0.8 : 1 })}>
            <Coins size={14} color={T.amber} />
            <Txt v="mono" w={600} size={12.5} color={T.amber}>
              {coins == null ? '—' : fmtCoins(coins)}
            </Txt>
            <Txt w={700} size={12} color={T.amber}>
              +
            </Txt>
          </Pressable>
        </View>
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
                {r.roomType && r.roomType !== 'standard' ? (
                  <View style={{ position: 'absolute', bottom: 8, left: 8 }}>
                    <RoomTypeBadge type={r.roomType} small />
                  </View>
                ) : null}
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
                <Txt size={10.5} color={T.muted} style={{ marginTop: 3 }} numberOfLines={1}>
                  {r.host?.name}
                  {r.guest ? ` & ${r.guest.name}` : ''}
                  {r.roomType === 'speed_dating' ? ` · ${(r.daters ?? 0) + 1}/4 on stage` : ''}
                </Txt>
                {r.roomType === 'question_night' && r.question ? (
                  <Txt size={10.5} color={T.text} style={{ marginTop: 3 }} numberOfLines={2}>
                    🌙 {r.question}
                  </Txt>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </FadeUp>

      <GoLiveSheet
        visible={showGoLive}
        onClose={() => setShowGoLive(false)}
        busy={starting}
        eligibility={elig}
        onFixProfile={() => {
          setShowGoLive(false);
          router.push('/profile');
        }}
        onStart={async (title, category, guest, roomType, question) => {
          setStarting(true);
          try {
            const id = await startLive(title, category, guest?.id ?? null, roomType, question);
            setShowGoLive(false);
            const next: LiveRoom = {
              id,
              real: true,
              title,
              category,
              host: { name: 'You', photo: me?.photo ?? null },
              hostId: me?.id,
              guest: guest ? { name: guest.name, photo: guest.photo } : undefined,
              guestId: guest?.id ?? null,
              liveMatch: !!guest,
              roomType,
              question,
              cover: me?.photo ?? null,
              viewers: 0,
              reactions: 0,
              isSelf: true,
            };
            setTimeout(() => setRoom(next), 350);
          } catch (e) {
            // The Go Live sheet is a modal, so the app toast would sit underneath it.
            Alert.alert("Couldn't go live", liveErrorMessage(e));
          } finally {
            setStarting(false);
          }
        }}
      />
      <LiveRoomView
        room={room}
        onClose={() => {
          setRoom(null);
          void reload();
        }}
      />
    </Screen>
  );
}
