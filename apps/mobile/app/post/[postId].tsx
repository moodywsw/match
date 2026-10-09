import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Heart, MessageCircle, Send } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inputStyle } from '@/components/app/AuthForm';
import { Avatar, EmptyState, IconBtn, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { addComment, fetchComments, fetchPost, togglePostLike, type FeedComment, type FeedPost } from '@/lib/feed';
import { timeAgo } from '@/lib/inbox';
import { fetchPrimaryPhotos } from '@/lib/profile';
import { pushLatestNotification } from '@/lib/push';
import { friendlyError } from '@/lib/errors';

/** Single post + comments (opened from like / comment notifications). */
export default function PostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { toast } = useApp();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');

  const load = useCallback(async () => {
    if (!postId || !user?.id) return;
    try {
      const [p, c] = await Promise.all([fetchPost(postId, user.id), fetchComments(postId).catch(() => [] as FeedComment[])]);
      setPost(p);
      setComments(c);
      const ids = [...new Set(c.map((x) => x.user_id))];
      if (ids.length) setPhotos(await fetchPrimaryPhotos(ids).catch(() => ({})));
    } catch (err) {
      toast(friendlyError(err, 'Could not load post'));
    } finally {
      setLoading(false);
    }
  }, [postId, user?.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/social'));

  const like = async () => {
    if (!post || !user?.id) return;
    const was = post.likedByMe;
    setPost({ ...post, likedByMe: !was, likeCount: post.likeCount + (was ? -1 : 1) });
    try {
      await togglePostLike(post.id, user.id, was);
      if (!was && post.user_id !== user.id) void pushLatestNotification(post.user_id);
    } catch (err) {
      setPost((p) => (p ? { ...p, likedByMe: was, likeCount: p.likeCount + (was ? 1 : -1) } : p));
      toast(friendlyError(err, 'Like failed'));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !post || !user?.id) return;
    setInput('');
    try {
      await addComment(post.id, user.id, text);
      if (post.user_id !== user.id) void pushLatestNotification(post.user_id);
      await load();
    } catch (err) {
      toast(friendlyError(err, 'Comment failed'));
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: T.ink }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
        <IconBtn onPress={back}>
          <ArrowLeft size={18} color={T.text} />
        </IconBtn>
        <Txt v="display" size={18}>
          Post
        </Txt>
      </View>
      {loading ? (
        <ActivityIndicator color={T.rose} style={{ marginTop: 40 }} />
      ) : !post ? (
        <View style={{ padding: 18 }}>
          <EmptyState text="This post isn't available anymore.">
            <PrimaryButton small label="Back to Social" onPress={() => router.replace('/(tabs)/social')} />
          </EmptyState>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <View style={{ backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
                <Avatar uri={post.authorPhoto} name={post.authorName} size={36} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} size={13.5}>
                    {post.user_id === user?.id ? 'You' : post.authorName}
                  </Txt>
                  <Txt size={11} color={T.mutedDim}>
                    {timeAgo(post.created_at)}
                  </Txt>
                </View>
              </View>
              {post.content ? (
                <Txt size={13.5} lh={1.45} style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                  {post.content}
                </Txt>
              ) : null}
              {post.media_url ? <Image source={{ uri: post.media_url }} style={{ width: '100%', height: 260, backgroundColor: T.surface3 }} resizeMode="cover" /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: T.border }}>
                <Pressable onPress={like} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Heart size={17} color={post.likedByMe ? T.rose : T.muted} fill={post.likedByMe ? T.rose : 'none'} />
                  <Txt size={12} color={T.muted}>
                    {post.likeCount}
                  </Txt>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <MessageCircle size={17} color={T.muted} />
                  <Txt size={12} color={T.muted}>
                    {comments.length}
                  </Txt>
                </View>
              </View>
            </View>

            <Txt w={700} size={14} style={{ marginTop: 20, marginBottom: 12 }}>
              Comments
            </Txt>
            {comments.length === 0 ? (
              <Txt size={13} color={T.mutedDim}>
                No comments yet — start the conversation.
              </Txt>
            ) : (
              <View style={{ gap: 12 }}>
                {comments.map((c) => (
                  <View key={c.id} style={{ flexDirection: 'row', gap: 10 }}>
                    <Avatar uri={photos[c.user_id]} name={c.authorName} size={30} />
                    <View style={{ flex: 1 }}>
                      <Txt w={700} size={12.5}>
                        {c.user_id === user?.id ? 'You' : c.authorName}
                        <Txt size={11} color={T.mutedDim}>
                          {'  '}
                          {timeAgo(c.created_at)}
                        </Txt>
                      </Txt>
                      <Txt size={13} style={{ marginTop: 2 }}>
                        {c.content}
                      </Txt>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderTopColor: T.border }}>
            <TextInput value={input} onChangeText={setInput} onSubmitEditing={send} placeholder="Add a comment…" placeholderTextColor={T.mutedDim} style={[inputStyle, { flex: 1, width: undefined, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, fontSize: 13 }]} />
            <Pressable onPress={send}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: T.rose, alignItems: 'center', justifyContent: 'center', marginTop: 3 }}>
                <Send size={16} color="#fff" />
              </View>
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
