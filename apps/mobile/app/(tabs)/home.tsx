import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { LiveRoomView } from '@/components/app/LiveRoom';
import { Screen } from '@/components/app/Screen';
import { Chip, DarkPill, FadeUp, LiveBadge, Photo, SectionTitle } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useEvents } from '@/hooks/useEvents';
import { hash01, interestIcon, LIVE_ROOMS, type LiveRoom, type Person } from '@/lib/mock';

const CARD_SHADOW = { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 18 } };

export default function HomeTab() {
  const router = useRouter();
  const { profile } = useAuth();
  const { me, people, likedIds, like, reloadPeople, peopleLoading } = useApp();
  const { events } = useEvents();
  const [liveRoom, setLiveRoom] = useState<LiveRoom | null>(null);

  const top = useMemo(() => [...people].sort((a, b) => b.match - a.match).slice(0, 3), [people]);
  const trending = useMemo(() => [...people].sort((a, b) => hash01(a.id, 3) - hash01(b.id, 3)).slice(0, 6), [people]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const tags = me?.interests ?? [];
  const name = profile?.name || me?.name || '';

  return (
    <Screen padTop={18} refreshing={peopleLoading} onRefresh={reloadPeople}>
      <FadeUp>
        <Txt v="display" size={24} style={{ marginBottom: 2 }}>
          {greeting}, {name} 👋
        </Txt>
        <Txt size={13.5} color={T.muted} style={{ marginBottom: 20 }}>
          Here's who matches your vibe today.
        </Txt>

        <SectionTitle title="Your top matches" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingBottom: 18 }}>
          {top.map((p) => (
            <TopMatchCard key={p.id} p={p} liked={likedIds.has(p.id)} onLike={() => like(p)} />
          ))}
        </ScrollView>

        <SectionTitle title="Because you like" sub={tags.slice(0, 3).map((t) => interestIcon(t) ?? '').join(' ')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {tags.length ? (
            tags.map((t) => <Chip key={t} label={t} active />)
          ) : (
            <Pressable onPress={() => router.navigate('/(tabs)/profile')}>
              <Chip label="✨ Add your taste in Profile" />
            </Pressable>
          )}
        </View>

        <SectionTitle title="Live now" action="See all" onAction={() => router.navigate('/(tabs)/live')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 22 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingBottom: 4 }}>
          {LIVE_ROOMS.slice(0, 4).map((r) => (
            <Pressable key={r.id} onPress={() => setLiveRoom(r)} style={{ width: 120, borderWidth: 1, borderColor: T.border, borderRadius: 18, backgroundColor: T.surface, overflow: 'hidden' }}>
              <View style={{ height: 90 }}>
                <Photo uri={r.cover} style={{ width: '100%', height: '100%' }} />
                <View style={{ position: 'absolute', top: 6, left: 6 }}>
                  <LiveBadge />
                </View>
              </View>
              <View style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
                <Txt w={700} size={12} numberOfLines={1}>
                  {r.title}
                </Txt>
                <Txt size={10.5} color={T.muted} style={{ marginTop: 2 }}>
                  {r.viewers} watching
                </Txt>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <SectionTitle title="Trending people" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
          {trending.map((p) => (
            <Pressable key={p.id} onPress={() => router.navigate('/(tabs)/discover')} style={{ width: '48.5%', backgroundColor: T.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: T.border }}>
              <View style={{ height: 100 }}>
                <Photo uri={p.photo} name={p.name} style={{ width: '100%', height: '100%' }} />
                <DarkPill style={{ position: 'absolute', bottom: 6, left: 6 }}>
                  <Txt v="mono" size={10.5}>
                    {p.match}% match
                  </Txt>
                </DarkPill>
              </View>
              <View style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
                <Txt w={700} size={12.5}>
                  {p.name}
                  {p.age ? `, ${p.age}` : ''}
                </Txt>
              </View>
            </Pressable>
          ))}
        </View>

        <SectionTitle title="Events near you" action="See all" onAction={() => router.navigate('/(tabs)/events')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingBottom: 8 }}>
          {events.slice(0, 3).map((e) => (
            <Pressable key={e.id} onPress={() => router.navigate('/(tabs)/events')} style={{ width: 190, backgroundColor: T.surface, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: T.border }}>
              <Photo uri={e.cover} name={e.title} style={{ width: '100%', height: 90 }} />
              <View style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                <Txt w={700} size={13} numberOfLines={1}>
                  {e.title}
                </Txt>
                <Txt size={11} color={T.muted} style={{ marginTop: 3 }}>
                  {e.date} · {e.location}
                </Txt>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </FadeUp>
      <LiveRoomView room={liveRoom} onClose={() => setLiveRoom(null)} />
    </Screen>
  );
}

function TopMatchCard({ p, liked, onLike }: { p: Person; liked: boolean; onLike: () => void }) {
  return (
    <View style={[{ width: 150, backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.border }, CARD_SHADOW]}>
      <View style={{ height: 130, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }}>
        {p.photo ? <Image source={{ uri: p.photo }} style={{ width: '100%', height: '100%' }} /> : <Photo uri={null} name={p.name} style={{ width: '100%', height: '100%' }} />}
        <DarkPill style={{ position: 'absolute', top: 8, right: 8, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 8 }}>
          <Txt size={11}>❤️</Txt>
          <Txt v="mono" w={600} size={11}>
            {p.match}%
          </Txt>
        </DarkPill>
      </View>
      <View style={{ paddingTop: 10, paddingHorizontal: 12, paddingBottom: 14 }}>
        <Txt w={700} size={14} numberOfLines={1}>
          {p.name}
          {p.age ? `, ${p.age}` : ''}
        </Txt>
        <Txt size={11.5} color={T.muted} style={{ marginTop: 2, marginBottom: 8 }} numberOfLines={1}>
          {p.city || 'Nearby'}
        </Txt>
        <Pressable onPress={onLike} disabled={liked}>
          <LinearGradient colors={liked ? [T.surface3, T.surface3] : [T.rose, T.coral]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ paddingVertical: 7, borderRadius: 999, alignItems: 'center' }}>
            <Txt w={700} size={12} color="#fff">
              {liked ? 'Liked ✓' : 'Like'}
            </Txt>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}
