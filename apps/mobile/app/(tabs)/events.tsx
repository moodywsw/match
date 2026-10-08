import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';

import { Screen } from '@/components/app/Screen';
import { Avatar, DarkPill, FadeUp, Photo } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useEvents } from '@/hooks/useEvents';
import { hash01 } from '@/lib/mock';

export default function EventsTab() {
  const { people, toast } = useApp();
  const { events, going, toggle, reload } = useEvents();

  const onToggle = async (e: (typeof events)[number]) => {
    try {
      const now = await toggle(e);
      toast(now ? `You're going to ${e.title} 🎉` : 'Removed from your events');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'RSVP failed');
    }
  };

  return (
    <Screen refreshing={false} onRefresh={reload}>
      <FadeUp>
        <Txt v="display" size={22} style={{ marginBottom: 4 }}>
          Events
        </Txt>
        <Txt size={13} color={T.muted} style={{ marginBottom: 16 }}>
          Real-world ways to meet your matches.
        </Txt>
        <View style={{ gap: 14 }}>
          {events.map((e) => {
            const start = Math.floor(hash01(e.id) * Math.max(1, people.length - 3));
            const attendees = people.slice(start, start + 3);
            const featured = attendees[0];
            const isGoing = !!going[e.id];
            return (
              <View key={e.id} style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 20, overflow: 'hidden' }}>
                <View style={{ height: 130 }}>
                  <Photo uri={e.cover} name={e.title} style={{ width: '100%', height: '100%' }} />
                  <DarkPill style={{ position: 'absolute', top: 10, left: 10, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                    <Txt size={11}>{e.category}</Txt>
                  </DarkPill>
                </View>
                <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
                  <Txt w={700} size={15}>
                    {e.title}
                  </Txt>
                  <Txt size={12} color={T.muted} style={{ marginTop: 3, marginBottom: 8 }}>
                    {e.date}
                    {e.location ? ` · ${e.location}` : ''}
                  </Txt>
                  {!e.real && featured ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row' }}>
                        {attendees.map((p, i) => (
                          <Avatar key={p.id} uri={p.photo} name={p.name} size={24} style={{ borderWidth: 2, borderColor: T.surface, marginLeft: i ? -8 : 0 }} />
                        ))}
                      </View>
                      <Txt size={11.5} color={T.muted} style={{ flex: 1 }} numberOfLines={1}>
                        {e.going} going · incl. {featured.name} ({featured.match}% match)
                      </Txt>
                    </View>
                  ) : null}
                  <Pressable onPress={() => onToggle(e)}>
                    {isGoing ? (
                      <View style={{ padding: 10, borderRadius: 999, borderWidth: 1, borderColor: T.mint, alignItems: 'center' }}>
                        <Txt w={700} size={13} color={T.mint}>
                          ✓ I'm going
                        </Txt>
                      </View>
                    ) : (
                      <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ padding: 10, borderRadius: 999, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' }}>
                        <Txt w={700} size={13} color="#fff">
                          I'm going
                        </Txt>
                      </LinearGradient>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </FadeUp>
    </Screen>
  );
}
