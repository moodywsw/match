import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { fetchChatList, type ChatListItem } from '@/lib/chat';

export default function ChatListScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      const rows = await fetchChatList(user.id);
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  if (loading && !items.length) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color="#E11D48" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Chat</Text>
      <Text style={styles.sub}>Matches & realtime messages</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.conversationId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#E11D48" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.sub}>
              Mutual likes create a match (DB trigger) and open a conversation here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/chat/${item.conversationId}`)}>
            {item.otherPhoto ? (
              <Image source={{ uri: item.otherPhoto }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarLetter}>{item.otherName.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.rowBody}>
              <Text style={styles.name}>{item.otherName}</Text>
              <Text style={styles.preview} numberOfLines={1}>
                {item.lastMessage || 'Say hello 👋'}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B0F', paddingTop: 16, paddingHorizontal: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { color: '#F4F4F5', fontSize: 28, fontWeight: '800' },
  sub: { color: '#9CA3AF', marginTop: 4, marginBottom: 12, lineHeight: 20 },
  error: { color: '#FB7185', marginBottom: 8 },
  empty: { paddingTop: 48, alignItems: 'center', paddingHorizontal: 12 },
  emptyTitle: { color: '#F4F4F5', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
    gap: 12,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#27272A' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#E11D48', fontWeight: '800', fontSize: 20 },
  rowBody: { flex: 1 },
  name: { color: '#F4F4F5', fontWeight: '700', fontSize: 16 },
  preview: { color: '#A1A1AA', marginTop: 2 },
});
