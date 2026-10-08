import { useFocusEffect, useRouter } from 'expo-router';
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Plus, Send, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinear, Stop } from 'react-native-svg';

import { inputStyle } from '@/components/app/AuthForm';
import { Screen } from '@/components/app/Screen';
import { CreateStorySheet, StoryViewer } from '@/components/app/Stories';
import { Sheet } from '@/components/ui/Sheet';
import { Avatar, FadeUp, PopIn, PrimaryButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T, body } from '@/constants/theme';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { pushLatestNotification } from '@/lib/push';
import { addComment, createTextPost, fetchComments, fetchFeed, togglePostLike, type FeedPost } from '@/lib/feed';
import { POSTS, PROFILES, SHOW_DEMO_CONTENT, STORY_USERS, type StoryUser } from '@/lib/mock';
import { createStory, fetchStoryUsers, type NewStory } from '@/lib/stories';
import { reportUser } from '@/lib/safety';
import { friendlyError } from '@/lib/errors';

type UiPost = {
  id: string;
  real: boolean;
  authorId: string | null;
  name: string;
  photo: string | null;
  meta: string;
  type: string;
  content: string;
  image?: string | null;
  options?: string[];
  votes?: number[];
  likes: number;
  comments: number;
  liked: boolean;
};

type UiComment = { id: string; name: string; photo: string | null; text: string };

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function StoryRing({ size, seen, children }: { size: number; seen: boolean; children: React.ReactNode }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <SvgLinear id="sr" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={T.rose} />
            <Stop offset="50%" stopColor={T.amber} />
            <Stop offset="100%" stopColor={T.violet} />
          </SvgLinear>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 1.5} stroke={seen ? T.surface3 : 'url(#sr)'} strokeWidth={3} fill="none" />
      </Svg>
      {children}
    </View>
  );
}

export default function SocialTab() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { me, toast } = useApp();
  const [feedMode, setFeedMode] = useState('For You');
  const [realPosts, setRealPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState('');
  const [posting, setPosting] = useState(false);
  const [sampleLikes, setSampleLikes] = useState<Record<string, boolean>>({});
  const [saves, setSaves] = useState<Record<string, boolean>>({});
  const [voted, setVoted] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [storyIndex, setStoryIndex] = useState<number | null>(null);
  const [realStories, setRealStories] = useState<StoryUser[]>([]);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<UiPost | null>(null);

  const loadStories = useCallback(async () => {
    if (!user?.id) return;
    try {
      setRealStories(await fetchStoryUsers(user.id));
    } catch (err) {
      console.warn('[match] stories load failed', err);
    }
  }, [user?.id]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    void loadStories();
    try {
      setRealPosts(await fetchFeed(user.id));
    } catch (err) {
      toast(friendlyError(err, 'Failed to load feed'));
    } finally {
      setLoading(false);
    }
  }, [user?.id, toast]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const posts: UiPost[] = useMemo(() => {
    const real: UiPost[] = realPosts.map((p) => ({
      id: p.id,
      real: true,
      authorId: p.user_id,
      name: p.user_id === user?.id ? 'You' : p.authorName,
      photo: p.user_id === user?.id ? me?.photo ?? p.authorPhoto : p.authorPhoto,
      meta: ago(p.created_at),
      type: p.media_url ? 'photo' : p.type,
      content: p.content || '',
      image: p.media_url,
      likes: p.likeCount,
      comments: p.commentCount,
      liked: p.likedByMe,
    }));
    const samples: UiPost[] = SHOW_DEMO_CONTENT
      ? POSTS.map((p) => ({
          id: p.id,
          real: false,
          authorId: null,
          name: p.user.name,
          photo: p.user.photo,
          meta: `${p.user.city} · 2h`,
          type: p.type,
          content: p.content,
          image: p.image,
          options: p.options,
          votes: p.votes,
          likes: p.likes + (sampleLikes[p.id] ? 1 : 0),
          comments: p.comments,
          liked: !!sampleLikes[p.id],
        }))
      : [];
    let all = [...real, ...samples].filter((p) => !hidden[p.id]);
    if (feedMode === 'Trending') all = [...all].sort((a, b) => b.likes - a.likes);
    return all;
  }, [realPosts, user?.id, me?.photo, sampleLikes, hidden, feedMode]);

  async function onPost() {
    if (!user?.id || !composer.trim() || posting) return;
    setPosting(true);
    try {
      await createTextPost(user.id, composer);
      setComposer('');
      toast('Posted ✨');
      await load();
    } catch (err) {
      toast(friendlyError(err, 'Could not post'));
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(p: UiPost) {
    if (!p.real) return setSampleLikes((l) => ({ ...l, [p.id]: !l[p.id] }));
    if (!user?.id) return;
    setRealPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, likedByMe: !x.likedByMe, likeCount: x.likedByMe ? Math.max(0, x.likeCount - 1) : x.likeCount + 1 } : x)));
    try {
      await togglePostLike(p.id, user.id, p.liked);
      if (!p.liked) void pushLatestNotification(p.authorId);
    } catch (err) {
      setRealPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, likedByMe: p.liked, likeCount: p.likes } : x)));
      toast(friendlyError(err, 'Like failed'));
    }
  }

  const toggleSave = (id: string) => {
    toast(saves[id] ? 'Removed from saved' : 'Saved post 🔖');
    setSaves((s) => ({ ...s, [id]: !s[id] }));
  };

  const myStory = realStories.find((u) => u.isMe) ?? null;
  const otherStories = [...realStories.filter((u) => !u.isMe), ...(SHOW_DEMO_CONTENT ? STORY_USERS : [])];
  const allStoryUsers = myStory ? [myStory, ...otherStories] : otherStories;
  const myName = profile?.name || 'You';

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <FadeUp>
        {/* stories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 14 }} contentContainerStyle={{ gap: 16, paddingHorizontal: 18 }}>
          <Pressable onPress={() => (myStory ? setStoryIndex(0) : setShowCreateStory(true))} onLongPress={() => setShowCreateStory(true)} style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ width: 56, height: 56 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderStyle: myStory ? 'solid' : 'dashed', borderColor: myStory ? T.mint : 'rgba(255,255,255,0.25)', padding: 2 }}>
                <Avatar uri={me?.photo} name={myName} size={48} />
              </View>
              <Pressable onPress={() => setShowCreateStory(true)} hitSlop={8} style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: T.rose, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: T.ink }}>
                <Plus size={11} color="#fff" />
              </Pressable>
            </View>
            <Txt size={10} color={T.muted}>
              Your story
            </Txt>
          </Pressable>
          {otherStories.map((p, i) => (
            <Pressable key={p.id} onPress={() => setStoryIndex(i + (myStory ? 1 : 0))} style={{ alignItems: 'center', gap: 4 }}>
              <StoryRing size={56} seen={!!p.seen || seen.includes(p.id)}>
                <Avatar uri={p.photo} name={p.name} size={48} style={{ borderWidth: 2, borderColor: T.ink }} />
              </StoryRing>
              <Txt size={10} color={T.muted}>
                {p.name}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>

        {/* feed modes */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {['Following', 'For You', 'Trending'].map((m) => (
            <Pressable key={m} onPress={() => setFeedMode(m)} style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: feedMode === m ? T.rose : T.border, backgroundColor: feedMode === m ? `${T.rose}22` : 'transparent' }}>
              <Txt w={600} size={12.5} color={feedMode === m ? '#fff' : T.muted}>
                {m}
              </Txt>
            </Pressable>
          ))}
        </View>

        {/* composer (real posts) */}
        <View style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 20, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar uri={me?.photo} name={myName} size={36} />
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder="Share something with MATCH…"
            placeholderTextColor={T.mutedDim}
            multiline
            style={{ flex: 1, color: T.text, fontSize: 13.5, maxHeight: 100, paddingVertical: 6, ...body(400) }}
          />
          <PrimaryButton small label="Post" onPress={onPost} loading={posting} disabled={!composer.trim()} />
        </View>

        <View style={{ gap: 16 }}>
          {posts.map((p) => (
            <View key={p.id} style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 20, zIndex: menuId === p.id ? 10 : 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 }}>
                <Avatar uri={p.photo} name={p.name} size={36} />
                <View style={{ flex: 1 }}>
                  <Txt w={700} size={13}>
                    {p.name}
                  </Txt>
                  <Txt size={10.5} color={T.mutedDim}>
                    {p.meta}
                  </Txt>
                </View>
                <Pressable onPress={() => setMenuId(menuId === p.id ? null : p.id)} hitSlop={10} style={{ padding: 4 }}>
                  <MoreHorizontal size={16} color={T.mutedDim} />
                </Pressable>
                {menuId === p.id ? (
                  <PopIn style={{ position: 'absolute', top: 40, right: 12, backgroundColor: T.surface3, borderWidth: 1, borderColor: T.border, borderRadius: 14, overflow: 'hidden', minWidth: 160, zIndex: 20 }}>
                    {[
                      { label: 'Hide post', fn: () => (setHidden((h) => ({ ...h, [p.id]: true })), toast('Post hidden')) },
                      {
                        label: 'Report post',
                        fn: async () => {
                          if (p.real && p.authorId && user?.id && p.authorId !== user.id) {
                            try {
                              await reportUser({ reporterId: user.id, reportedId: p.authorId, category: 'inappropriate', details: `Post ${p.id}: ${p.content.slice(0, 200)}` });
                              toast('Report submitted');
                            } catch (err) {
                              toast(friendlyError(err, 'Report failed'));
                            }
                          } else toast('Report submitted');
                        },
                      },
                      { label: 'Share post', fn: () => void Share.share({ message: `${p.name} on MATCH: ${p.content}` }) },
                    ].map((opt) => (
                      <Pressable
                        key={opt.label}
                        onPress={() => {
                          void opt.fn();
                          setMenuId(null);
                        }}
                        style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
                        <Txt size={12.5}>{opt.label}</Txt>
                      </Pressable>
                    ))}
                  </PopIn>
                ) : null}
              </View>
              {p.content ? (
                <Txt size={13.5} lh={1.45} style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                  {p.content}
                </Txt>
              ) : null}
              {p.image ? <Image source={{ uri: p.image }} style={{ width: '100%', height: 260, backgroundColor: T.surface3 }} resizeMode="cover" /> : null}
              {p.type === 'poll' && p.options ? (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {p.options.map((o, i) => {
                    const has = voted[p.id] !== undefined;
                    const pct = p.votes?.[i] ?? 50;
                    return (
                      <Pressable key={o} onPress={() => setVoted((v) => ({ ...v, [p.id]: i }))} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2, overflow: 'hidden' }}>
                        {has ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, backgroundColor: `${T.rose}33` }} /> : null}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Txt size={13}>{o}</Txt>
                          {has ? (
                            <Txt v="mono" size={13}>
                              {pct}%
                            </Txt>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: T.border }}>
                <Pressable onPress={() => toggleLike(p)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Heart size={17} color={p.liked ? T.rose : T.muted} fill={p.liked ? T.rose : 'none'} />
                  <Txt size={12} color={T.muted}>
                    {p.likes}
                  </Txt>
                </Pressable>
                <Pressable onPress={() => setCommentsFor(p)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <MessageCircle size={17} color={T.muted} />
                  <Txt size={12} color={T.muted}>
                    {p.comments}
                  </Txt>
                </Pressable>
                <Pressable onPress={() => void Share.share({ message: `${p.name} on MATCH: ${p.content}` })} hitSlop={6}>
                  <Share2 size={16} color={T.muted} />
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => toggleSave(p.id)} hitSlop={6}>
                  <Bookmark size={16} color={saves[p.id] ? T.amber : T.muted} fill={saves[p.id] ? T.amber : 'none'} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </FadeUp>

      <StoryViewer
        users={allStoryUsers}
        startIndex={storyIndex}
        onClose={() => {
          setStoryIndex(null);
          void loadStories();
        }}
        onViewed={(id) => setSeen((s) => (s.includes(id) ? s : [...s, id]))}
        toast={toast}
        meId={user?.id}
        onDeleted={loadStories}
        onOpenActivity={(storyId) => {
          setStoryIndex(null);
          router.push({ pathname: '/story/[storyId]', params: { storyId } });
        }}
      />
      <CreateStorySheet
        visible={showCreateStory}
        onClose={() => setShowCreateStory(false)}
        onCreate={async (story: NewStory) => {
          if (!user?.id) return;
          try {
            await createStory(user.id, story);
            setShowCreateStory(false);
            toast('Your story is live for 24h ✨');
            await loadStories();
          } catch (err) {
            toast(friendlyError(err, 'Could not share story'));
          }
        }}
      />
      <CommentsSheet
        post={commentsFor}
        onClose={() => setCommentsFor(null)}
        onAdded={(postId) => setRealPosts((prev) => prev.map((x) => (x.id === postId ? { ...x, commentCount: x.commentCount + 1 } : x)))}
      />
    </Screen>
  );
}

function CommentsSheet({ post, onClose, onAdded }: { post: UiPost | null; onClose: () => void; onAdded: (postId: string) => void }) {
  const { user } = useAuth();
  const { me, toast } = useApp();
  const [comments, setComments] = useState<UiComment[]>([]);
  const [input, setInput] = useState('');
  const postId = post?.id;

  const seed = useCallback((id: string): UiComment[] => {
    const n = Number(id.replace('sample-', '')) || 1;
    return [
      { id: 'c1', name: PROFILES[(n * 3) % 20].name, photo: PROFILES[(n * 3) % 20].photo, text: 'This is so real 😂' },
      { id: 'c2', name: PROFILES[(n * 3 + 1) % 20].name, photo: PROFILES[(n * 3 + 1) % 20].photo, text: 'Okay I need the details' },
      { id: 'c3', name: PROFILES[(n * 3 + 2) % 20].name, photo: PROFILES[(n * 3 + 2) % 20].photo, text: 'Same energy honestly' },
    ];
  }, []);

  const loadComments = useCallback(async () => {
    if (!post) return;
    if (!post.real) return setComments(seed(post.id));
    try {
      const rows = await fetchComments(post.id);
      setComments(rows.map((c) => ({ id: c.id, name: c.user_id === user?.id ? 'You' : c.authorName, photo: c.user_id === user?.id ? me?.photo ?? null : null, text: c.content })));
    } catch {
      setComments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  useEffect(() => {
    setComments([]);
    void loadComments();
  }, [loadComments]);

  const add = async () => {
    const text = input.trim();
    if (!text || !post) return;
    setInput('');
    if (!post.real) {
      setComments((c) => [...c, { id: `me-${Date.now()}`, name: 'You', photo: me?.photo ?? null, text }]);
      return;
    }
    if (!user?.id) return;
    try {
      await addComment(post.id, user.id, text);
      void pushLatestNotification(post.authorId);
      onAdded(post.id);
      await loadComments();
    } catch (err) {
      toast(friendlyError(err, 'Comment failed'));
    }
  };

  return (
    <Sheet visible={!!post} onClose={onClose} title="Comments" centerTitle height="70%" scroll={false}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        {comments.length === 0 ? (
          <Txt size={13} color={T.mutedDim} center>
            No comments yet — start the conversation.
          </Txt>
        ) : null}
        {comments.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', gap: 10 }}>
            <Avatar uri={c.photo} name={c.name} size={30} />
            <View style={{ flex: 1 }}>
              <Txt w={700} size={12.5}>
                {c.name}
              </Txt>
              <Txt size={13} style={{ marginTop: 2 }}>
                {c.text}
              </Txt>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={add} placeholder="Add a comment…" placeholderTextColor={T.mutedDim} style={[inputStyle, { flex: 1, width: undefined, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, fontSize: 13 }]} />
        <Pressable onPress={add}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: T.rose, alignItems: 'center', justifyContent: 'center', marginTop: 3 }}>
            <Send size={16} color="#fff" />
          </View>
        </Pressable>
      </View>
    </Sheet>
  );
}
