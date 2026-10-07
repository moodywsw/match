import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchLiveStreams, type LiveRow } from '@/lib/explore';

export default function LiveScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLiveStreams()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={styles.screen}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>
      <Text style={styles.title}>Live</Text>
      <Text style={styles.sub}>
        Lists open `live_streams` rows. Full A/V streaming is not implemented — metadata stub only.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator color="#E11D48" style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={
            <Text style={styles.sub}>No live streams right now.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.sub}>
                {item.hostName} · {item.category}
                {item.is_live_match ? ' · Live Match' : ''}
              </Text>
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
  error: { color: '#FB7185', marginTop: 8 },
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  cardTitle: { color: '#F4F4F5', fontWeight: '800', fontSize: 16 },
});
