import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Calendar, MapPin, Pencil, Trash2, Users, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventFormSheet } from '@/components/app/EventForm';
import { RsvpButtons } from '@/components/app/EventParts';
import { Avatar, DarkPill, EmptyState, IconBtn, Photo, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  deleteEvent,
  eventErrorMessage,
  eventPlace,
  fetchEvent,
  fetchEventAttendees,
  fmtEventDate,
  setEventCancelled,
  setRsvp,
  type EventAttendee,
  type EventDetail,
  type RsvpStatus,
} from '@/lib/events';
import { ageFromBirthDate, fetchPrimaryPhotos } from '@/lib/profile';

export default function EventScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { toast } = useApp();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const [ev, people] = await Promise.all([fetchEvent(eventId), fetchEventAttendees(eventId).catch(() => [] as EventAttendee[])]);
      setEvent(ev);
      setAttendees(people);
      const ids = [...new Set([...people.map((p) => p.user_id), ...(ev?.creator_id ? [ev.creator_id] : [])])];
      if (ids.length) setPhotos(await fetchPrimaryPhotos(ids).catch(() => ({})));
    } catch (err) {
      toast(eventErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [eventId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/events'));

  const onRsvp = async (s: RsvpStatus) => {
    if (!event || !user?.id) return;
    const next = event.my_status === s ? null : s;
    setBusy(true);
    try {
      await setRsvp(event.id, user.id, next);
      toast(next === 'going' ? `You're going to ${event.title} 🎉` : next === 'interested' ? "Saved — we'll keep you posted" : 'Removed from your events');
      await load();
    } catch (err) {
      toast(eventErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = () => {
    if (!event) return;
    const cancelling = event.status === 'scheduled';
    Alert.alert(
      cancelling ? 'Cancel this event?' : 'Reinstate this event?',
      cancelling ? 'Everyone who RSVP’d will be notified.' : 'Attendees will be notified that it’s back on.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: cancelling ? 'Cancel event' : 'Reinstate',
          style: cancelling ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(true);
            try {
              await setEventCancelled(event.id, cancelling);
              toast(cancelling ? 'Event cancelled — attendees notified' : 'Event is back on 🎉');
              await load();
            } catch (err) {
              toast(eventErrorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const confirmDelete = () => {
    if (!event) return;
    Alert.alert('Delete this event?', 'It will be removed for everyone and attendees will be notified.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteEvent(event.id);
            toast('Event deleted');
            back();
          } catch (err) {
            toast(eventErrorMessage(err));
            setBusy(false);
          }
        },
      },
    ]);
  };

  const going = attendees.filter((a) => a.status === 'going');
  const interested = attendees.filter((a) => a.status === 'interested');
  const place = event ? eventPlace(event) : '';

  return (
    <View style={{ flex: 1, backgroundColor: T.ink }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={T.rose} progressViewOffset={insets.top} />}>
        <View style={{ height: 250 + insets.top }}>
          <Photo uri={event?.cover_url} name={event?.title || 'Event'} style={{ width: '100%', height: '100%' }} />
          <LinearGradient colors={['rgba(21,18,28,0.55)', 'transparent', T.ink]} locations={[0, 0.45, 1]} style={{ position: 'absolute', inset: 0 }} />
          <View style={{ position: 'absolute', top: insets.top + 10, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' }}>
            <IconBtn onPress={back}>
              <ArrowLeft size={18} color={T.text} />
            </IconBtn>
            {event?.is_mine && event.status === 'scheduled' ? (
              <IconBtn onPress={() => setEditing(true)}>
                <Pencil size={16} color={T.text} />
              </IconBtn>
            ) : null}
          </View>
          {event ? (
            <View style={{ position: 'absolute', left: 18, bottom: 14, flexDirection: 'row', gap: 6 }}>
              <DarkPill style={{ borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                <Txt size={11}>{event.category || 'Event'}</Txt>
              </DarkPill>
              {event.status === 'cancelled' ? (
                <DarkPill style={{ borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
                  <Txt size={11} color={T.rose}>
                    Cancelled
                  </Txt>
                </DarkPill>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 18 }}>
          {loading ? (
            <ActivityIndicator color={T.rose} style={{ marginTop: 30 }} />
          ) : !event ? (
            <EmptyState text="This event isn't available anymore.">
              <PrimaryButton small label="Browse events" onPress={() => router.replace('/(tabs)/events')} />
            </EmptyState>
          ) : (
            <>
              <Txt v="display" size={24} style={{ marginTop: 4 }}>
                {event.title}
              </Txt>
              <View style={{ gap: 8, marginTop: 12 }}>
                <InfoRow icon={<Calendar size={15} color={T.rose} />} text={fmtEventDate(event.starts_at, event.ends_at)} />
                {place || event.distance_km != null ? (
                  <InfoRow icon={<MapPin size={15} color={T.violet} />} text={[place, event.distance_km != null ? `~${event.distance_km} km away` : null].filter(Boolean).join(' · ')} />
                ) : null}
                <InfoRow
                  icon={<Users size={15} color={T.mint} />}
                  text={`${event.going_count} going${event.interested_count ? ` · ${event.interested_count} interested` : ''}${event.capacity ? ` · ${Math.max(0, event.capacity - event.going_count)} of ${event.capacity} spots left` : ''}`}
                />
              </View>

              {event.creator_name ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 12, borderRadius: 16, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border }}>
                  <Avatar uri={event.creator_id ? photos[event.creator_id] : null} name={event.creator_name} size={34} />
                  <View style={{ flex: 1 }}>
                    <Txt size={11} color={T.muted}>
                      Hosted by
                    </Txt>
                    <Txt w={700} size={13.5}>
                      {event.is_mine ? 'You' : event.creator_name}
                    </Txt>
                  </View>
                </View>
              ) : null}

              {event.description ? (
                <Txt size={13.5} color={T.text} lh={1.45} style={{ marginTop: 16 }}>
                  {event.description}
                </Txt>
              ) : null}

              <View style={{ marginTop: 18 }}>
                <RsvpButtons event={event} disabled={busy} onRsvp={onRsvp} />
              </View>

              <AttendeeList title={`Going · ${event.going_count}`} people={going} photos={photos} />
              {interested.length ? <AttendeeList title={`Interested · ${event.interested_count}`} people={interested} photos={photos} /> : null}
              {going.length < event.going_count ? (
                <Txt size={11} color={T.mutedDim} style={{ marginTop: 6 }}>
                  Some attendees are hidden for privacy.
                </Txt>
              ) : null}

              {event.is_mine ? (
                <View style={{ marginTop: 26, gap: 10 }}>
                  {event.status === 'scheduled' ? (
                    <OwnerAction icon={<Pencil size={15} color={T.text} />} label="Edit event" onPress={() => setEditing(true)} />
                  ) : null}
                  <OwnerAction
                    icon={<XCircle size={15} color={event.status === 'scheduled' ? T.amber : T.mint} />}
                    label={event.status === 'scheduled' ? 'Cancel event' : 'Reinstate event'}
                    onPress={confirmCancel}
                  />
                  <OwnerAction icon={<Trash2 size={15} color={T.rose} />} label="Delete event" color={T.rose} onPress={confirmDelete} />
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
      <EventFormSheet
        visible={editing}
        event={event}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
      />
    </View>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {icon}
      <Txt size={13.5} color={T.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

function AttendeeList({ title, people, photos }: { title: string; people: EventAttendee[]; photos: Record<string, string> }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Txt w={700} size={14} style={{ marginBottom: 10 }}>
        {title}
      </Txt>
      {people.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {people.map((p) => {
            const age = ageFromBirthDate(p.birth_date);
            return (
              <View key={p.user_id} style={{ width: 64, alignItems: 'center' }}>
                <Avatar uri={photos[p.user_id]} name={p.name} size={52} ring={p.is_me ? T.rose : undefined} />
                <Txt size={11.5} numberOfLines={1} style={{ marginTop: 5 }}>
                  {p.is_me ? 'You' : p.name}
                  {!p.is_me && age ? `, ${age}` : ''}
                </Txt>
              </View>
            );
          })}
        </View>
      ) : (
        <Txt size={12.5} color={T.mutedDim}>
          No one yet — be the first.
        </Txt>
      )}
    </View>
  );
}

function OwnerAction({ icon, label, onPress, color = T.text }: { icon: React.ReactNode; label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, opacity: pressed ? 0.8 : 1 })}>
      {icon}
      <Txt w={600} size={13.5} color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}
