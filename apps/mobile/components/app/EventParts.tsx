import { LinearGradient } from 'expo-linear-gradient';
import { Star } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import type { EventDetail, RsvpStatus } from '@/lib/events';

/** "I'm going" (prototype gradient / mint outline when set) + "Interested". */
export function RsvpButtons({ event, onRsvp, disabled }: { event: EventDetail; onRsvp: (s: RsvpStatus) => void; disabled?: boolean }) {
  const going = event.my_status === 'going';
  const interested = event.my_status === 'interested';
  const full = event.capacity != null && event.going_count >= event.capacity && !going;
  if (event.status === 'cancelled') {
    return (
      <View style={{ padding: 10, borderRadius: 999, borderWidth: 1, borderColor: T.border, alignItems: 'center', backgroundColor: T.surface2 }}>
        <Txt w={700} size={13} color={T.mutedDim}>
          Cancelled
        </Txt>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8, opacity: disabled ? 0.6 : 1 }}>
      <Pressable style={{ flex: 1 }} disabled={disabled || (full && !going)} onPress={() => onRsvp('going')}>
        {going ? (
          <View style={{ padding: 10, borderRadius: 999, borderWidth: 1, borderColor: T.mint, alignItems: 'center' }}>
            <Txt w={700} size={13} color={T.mint}>
              ✓ I'm going
            </Txt>
          </View>
        ) : full ? (
          <View style={{ padding: 10, borderRadius: 999, borderWidth: 1, borderColor: T.border, alignItems: 'center', backgroundColor: T.surface2 }}>
            <Txt w={700} size={13} color={T.mutedDim}>
              Full
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
      <Pressable
        disabled={disabled}
        onPress={() => onRsvp('interested')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: interested ? T.amber : T.border, backgroundColor: interested ? `${T.amber}1A` : T.surface2 }}>
        <Star size={14} color={interested ? T.amber : T.muted} fill={interested ? T.amber : 'transparent'} />
        <Txt w={700} size={13} color={interested ? T.amber : T.muted}>
          Interested
        </Txt>
      </Pressable>
    </View>
  );
}

/** Overlapping attendee avatars + "N going · M interested". */
export function AttendeeRow({ event, photos, names }: { event: EventDetail; photos: Record<string, string>; names?: Record<string, string> }) {
  const ids = event.attendee_ids.slice(0, 4);
  const cap = event.capacity ? ` · ${Math.max(0, event.capacity - event.going_count)} spots left` : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {ids.length ? (
        <View style={{ flexDirection: 'row' }}>
          {ids.map((id, i) => (
            <Avatar key={id} uri={photos[id]} name={names?.[id] || '?'} size={24} style={{ borderWidth: 2, borderColor: T.surface, marginLeft: i ? -8 : 0 }} />
          ))}
        </View>
      ) : null}
      <Txt size={11.5} color={T.muted} style={{ flex: 1 }} numberOfLines={1}>
        {event.going_count} going{event.interested_count ? ` · ${event.interested_count} interested` : ''}
        {event.status === 'scheduled' ? cap : ''}
      </Txt>
    </View>
  );
}
