import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { fetchUpcomingEvents, rsvpEvent, type EventRow } from '@/lib/explore';

export default function EventsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchUpcomingEvents()
      .then(setEvents)
      .catch((e) => setMsg(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function onRsvp(id: string) {
    if (!user?.id) return;
    try {
      await rsvpEvent(id, user.id);
      setMsg('RSVP saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'RSVP failed');
    }
  }

  return (
    <View style={styles.screen}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>
      <Text style={styles.title}>Events</Text>
      <Text style={styles.sub}>Reads `public.events` · RSVP via `event_participants`</Text>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {loading ? (
        <ActivityIndicator color="#E11D48" style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          ListEmptyComponent={
            <Text style={styles.sub}>No upcoming events in the database yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.sub}>
                {[item.category, item.location].filter(Boolean).join(' · ') || '—'}
              </Text>
              <Text style={styles.sub}>{new Date(item.starts_at).toLocaleString()}</Text>
              <Pressable style={styles.btn} onPress={() => onRsvp(item.id)}>
                <Text style={styles.btnText}>RSVP</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B0F', padding: 16 },
  back: { color: '#E11D48', fontWeight: '700', marginBottom: 8 },
  title: { color: '#F4F4F5', fontSize: 28, fontWeight: '800' },
  sub: { color: '#9CA3AF', marginTop: 4, lineHeight: 20 },
  msg: { color: '#86EFAC', marginVertical: 8 },
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    gap: 4,
  },
  cardTitle: { color: '#F4F4F5', fontWeight: '800', fontSize: 16 },
  btn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#E11D48',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
