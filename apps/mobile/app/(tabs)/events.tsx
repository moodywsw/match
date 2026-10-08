import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { MapPin, Plus, Search } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { EventFormSheet } from '@/components/app/EventForm';
import { AttendeeRow, RsvpButtons } from '@/components/app/EventParts';
import { Screen } from '@/components/app/Screen';
import { Chip, DarkPill, EmptyState, FadeUp, Photo, PrimaryButton, Skeleton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useEvents, type EventFilters } from '@/hooks/useEvents';
import { EVENT_CATEGORIES, eventPlace, fmtEventDate, type EventDetail, type RsvpStatus } from '@/lib/events';

export default function EventsTab() {
  const router = useRouter();
  const { toast } = useApp();
  const [filters, setFilters] = useState<EventFilters>({ scope: 'upcoming', category: null, city: '' });
  const { events, photos, rsvp, reload, loading, error } = useEvents(filters);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const first = useRef(true);

  // Refresh when coming back from the detail screen (RSVP / edits made there).
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reload();
    }, [reload])
  );

  const onRsvp = async (e: EventDetail, s: RsvpStatus) => {
    setBusy(e.id);
    try {
      const now = await rsvp(e, s);
      toast(now === 'going' ? `You're going to ${e.title} 🎉` : now === 'interested' ? `Saved — we'll keep you posted` : 'Removed from your events');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'RSVP failed');
    } finally {
      setBusy(null);
    }
  };

  const open = (id: string) => router.push({ pathname: '/event/[eventId]', params: { eventId: id } });

  return (
    <Screen refreshing={false} onRefresh={reload}>
      <FadeUp>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt v="display" size={22} style={{ marginBottom: 4 }}>
              Events
            </Txt>
            <Txt size={13} color={T.muted} style={{ marginBottom: 16 }}>
              Real-world ways to meet your matches.
            </Txt>
          </View>
          <Pressable onPress={() => setCreating(true)} accessibilityLabel="Create event">
            <LinearGradient colors={[T.rose, T.coral]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {(
            [
              ['upcoming', 'Upcoming'],
              ['mine', 'My events'],
            ] as const
          ).map(([k, l]) => (
            <Chip key={k} small label={l} active={filters.scope === k} onPress={() => setFilters((f) => ({ ...f, scope: k }))} />
          ))}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2 }}>
            <Search size={13} color={T.mutedDim} />
            <TextInput
              value={filters.city}
              onChangeText={(city) => setFilters((f) => ({ ...f, city }))}
              placeholder="City or area"
              placeholderTextColor={T.mutedDim}
              style={{ flex: 1, color: T.text, fontSize: 12.5, paddingVertical: 6 }}
            />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 14 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18 }}>
          <Chip small label="All" active={!filters.category} onPress={() => setFilters((f) => ({ ...f, category: null }))} />
          {EVENT_CATEGORIES.map((c) => (
            <Chip key={c} small label={c} active={filters.category === c} onPress={() => setFilters((f) => ({ ...f, category: f.category === c ? null : c }))} />
          ))}
        </ScrollView>

        {loading && !events.length ? (
          <View style={{ gap: 14 }}>
            {[0, 1].map((i) => (
              <Skeleton key={i} width="100%" height={250} radius={20} />
            ))}
          </View>
        ) : !events.length ? (
          <EmptyState text={error ? `Couldn't load events — ${error}` : filters.scope === 'mine' ? "You haven't created or joined any upcoming events yet." : 'No upcoming events match — be the first to host one.'}>
            <PrimaryButton small label="Create an event" onPress={() => setCreating(true)} style={{ marginTop: 6 }} />
          </EmptyState>
        ) : (
          <View style={{ gap: 14 }}>
            {events.map((e) => {
              const place = eventPlace(e);
              return (
                <Pressable key={e.id} onPress={() => open(e.id)} style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 20, overflow: 'hidden', opacity: e.status === 'cancelled' ? 0.7 : 1 }}>
                  <View style={{ height: 130 }}>
                    <Photo uri={e.cover_url} name={e.title} style={{ width: '100%', height: '100%' }} />
                    <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 }}>
                      <DarkPill style={{ borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                        <Txt size={11}>{e.category || 'Event'}</Txt>
                      </DarkPill>
                      {e.status === 'cancelled' ? (
                        <DarkPill style={{ borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                          <Txt size={11} color={T.rose}>
                            Cancelled
                          </Txt>
                        </DarkPill>
                      ) : e.is_mine ? (
                        <DarkPill style={{ borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                          <Txt size={11} color={T.amber}>
                            Hosting
                          </Txt>
                        </DarkPill>
                      ) : null}
                    </View>
                    {e.distance_km != null ? (
                      <DarkPill style={{ position: 'absolute', top: 10, right: 10, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                        <MapPin size={11} color="#fff" />
                        <Txt size={11}>~{e.distance_km} km</Txt>
                      </DarkPill>
                    ) : null}
                  </View>
                  <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
                    <Txt w={700} size={15}>
                      {e.title}
                    </Txt>
                    <Txt size={12} color={T.muted} style={{ marginTop: 3, marginBottom: 8 }} numberOfLines={1}>
                      {fmtEventDate(e.starts_at)}
                      {place ? ` · ${place}` : ''}
                    </Txt>
                    <AttendeeRow event={e} photos={photos} />
                    <RsvpButtons event={e} disabled={busy === e.id} onRsvp={(s) => onRsvp(e, s)} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </FadeUp>
      <EventFormSheet
        visible={creating}
        event={null}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          void reload();
          open(id);
        }}
      />
    </Screen>
  );
}
