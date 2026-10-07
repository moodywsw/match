import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { fetchActiveStories, fetchLiveStreams, fetchUpcomingEvents, type LiveRow, type StoryRow, type EventRow } from '@/lib/explore';
import {
  addComment,
  createTextPost,
  fetchComments,
  fetchFeed,
  togglePostLike,
  type FeedComment,
  type FeedPost,
} from '@/lib/feed';

export default function FeedScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentPost, setCommentPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentText, setCommentText] = useState('');

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      const [feed, st, ev, lv] = await Promise.all([
        fetchFeed(user.id),
        fetchActiveStories().catch(() => [] as StoryRow[]),
        fetchUpcomingEvents().catch(() => [] as EventRow[]),
        fetchLiveStreams().catch(() => [] as LiveRow[]),
      ]);
      setPosts(feed);
      setStories(st);
      setEvents(ev);
      setLives(lv);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feed');
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

  async function onPost() {
    if (!user?.id || !composer.trim() || posting) return;
    setPosting(true);
    try {
      await createTextPost(user.id, composer);
      setComposer('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post');
    } finally {
      setPosting(false);
    }
  }

  async function onToggleLike(post: FeedPost) {
    if (!user?.id) return;
    try {
      await togglePostLike(post.id, user.id, post.likedByMe);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likedByMe: !p.likedByMe,
                likeCount: p.likedByMe ? Math.max(0, p.likeCount - 1) : p.likeCount + 1,
              }
            : p
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Like failed');
    }
  }

  async function openComments(post: FeedPost) {
    setCommentPost(post);
    setCommentText('');
    try {
      setComments(await fetchComments(post.id));
    } catch {
      setComments([]);
    }
  }

  async function onAddComment() {
    if (!user?.id || !commentPost || !commentText.trim()) return;
    try {
      await addComment(commentPost.id, user.id, commentText);
      setCommentText('');
      setComments(await fetchComments(commentPost.id));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === commentPost.id ? { ...p, commentCount: p.commentCount + 1 } : p
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comment failed');
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Feed</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#E11D48" />}
        ListHeaderComponent={
          <View>
            <View style={styles.composerBox}>
              <TextInput
                style={styles.composer}
                placeholder="Share something…"
                placeholderTextColor="#6B7280"
                value={composer}
                onChangeText={setComposer}
                multiline
              />
              <Pressable
                style={[styles.postBtn, (!composer.trim() || posting) && styles.disabled]}
                onPress={onPost}
                disabled={!composer.trim() || posting}>
                {posting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.postBtnText}>Post</Text>
                )}
              </Pressable>
            </View>

            <Text style={styles.section}>Stories</Text>
            {stories.length === 0 ? (
              <Text style={styles.muted}>No active stories (24h). Stub reads `stories`.</Text>
            ) : (
              <FlatList
                horizontal
                data={stories}
                keyExtractor={(s) => s.id}
                showsHorizontalScrollIndicator={false}
                renderItem={({ item }) => (
                  <View style={styles.storyChip}>
                    <Text style={styles.storyName} numberOfLines={1}>
                      {item.authorName}
                    </Text>
                    <Text style={styles.storyType}>{item.type}</Text>
                  </View>
                )}
              />
            )}

            <View style={styles.quickRow}>
              <Pressable style={styles.quick} onPress={() => router.push('/events')}>
                <Text style={styles.quickText}>Events ({events.length})</Text>
              </Pressable>
              <Pressable style={styles.quick} onPress={() => router.push('/live')}>
                <Text style={styles.quickText}>Live ({lives.length})</Text>
              </Pressable>
            </View>

            <Text style={styles.section}>Posts</Text>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.muted}>Be the first — create a text post above.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              {item.authorPhoto ? (
                <Image source={{ uri: item.authorPhoto }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarLetter}>{item.authorName.charAt(0)}</Text>
                </View>
              )}
              <View>
                <Text style={styles.author}>{item.authorName}</Text>
                <Text style={styles.time}>
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
            </View>
            {item.content ? <Text style={styles.content}>{item.content}</Text> : null}
            {item.media_url ? (
              <Image source={{ uri: item.media_url }} style={styles.media} />
            ) : null}
            <View style={styles.actions}>
              <Pressable onPress={() => onToggleLike(item)}>
                <Text style={[styles.action, item.likedByMe && styles.liked]}>
                  ♥ {item.likeCount}
                </Text>
              </Pressable>
              <Pressable onPress={() => openComments(item)}>
                <Text style={styles.action}>💬 {item.commentCount}</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Modal visible={!!commentPost} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Comments</Text>
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 280 }}
              ListEmptyComponent={<Text style={styles.muted}>No comments yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.commentRow}>
                  <Text style={styles.author}>{item.authorName}</Text>
                  <Text style={styles.content}>{item.content}</Text>
                </View>
              )}
            />
            <TextInput
              style={styles.composer}
              placeholder="Add a comment…"
              placeholderTextColor="#6B7280"
              value={commentText}
              onChangeText={setCommentText}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setCommentPost(null)}>
                <Text style={styles.muted}>Close</Text>
              </Pressable>
              <Pressable style={styles.postBtn} onPress={onAddComment}>
                <Text style={styles.postBtnText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B0F', paddingTop: 16, paddingHorizontal: 16 },
  title: { color: '#F4F4F5', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  error: { color: '#FB7185', marginBottom: 8 },
  muted: { color: '#9CA3AF', lineHeight: 20 },
  section: { color: '#D4D4D8', fontWeight: '700', marginTop: 16, marginBottom: 8 },
  composerBox: { gap: 8, marginBottom: 4 },
  composer: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    color: '#F4F4F5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  postBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#E11D48',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  postBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  storyChip: {
    width: 88,
    marginRight: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  storyName: { color: '#F4F4F5', fontWeight: '700', fontSize: 12 },
  storyType: { color: '#E11D48', fontSize: 11, marginTop: 4 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  quick: {
    flex: 1,
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    paddingVertical: 12,
    alignItems: 'center',
  },
  quickText: { color: '#F4F4F5', fontWeight: '700' },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { color: '#F4F4F5', fontWeight: '700', fontSize: 16, marginBottom: 6 },
  card: {
    backgroundColor: '#18181B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#27272A' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#E11D48', fontWeight: '800' },
  author: { color: '#F4F4F5', fontWeight: '700' },
  time: { color: '#71717A', fontSize: 11 },
  content: { color: '#E4E4E7', lineHeight: 20 },
  media: { width: '100%', height: 180, borderRadius: 12, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 12 },
  action: { color: '#A1A1AA', fontWeight: '700' },
  liked: { color: '#E11D48' },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#18181B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 10,
  },
  modalTitle: { color: '#F4F4F5', fontWeight: '800', fontSize: 18 },
  commentRow: { marginBottom: 10 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
