import { supabase } from './supabase';
import { fetchPrimaryPhotos } from './profile';

export type FeedPost = {
  id: string;
  user_id: string;
  type: string;
  content: string | null;
  media_url: string | null;
  created_at: string;
  authorName: string;
  authorPhoto: string | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
};

export type FeedComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  authorName: string;
};

export async function fetchFeed(userId: string, limit = 40): Promise<FeedPost[]> {
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, user_id, type, content, media_url, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!posts?.length) return [];

  const postIds = posts.map((p) => p.id);
  const authorIds = [...new Set(posts.map((p) => p.user_id))];

  const [{ data: profiles }, photos, { data: likes }, { data: comments }] =
    await Promise.all([
      supabase.from('profiles').select('id, name').in('id', authorIds),
      fetchPrimaryPhotos(authorIds),
      supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
      supabase.from('comments').select('post_id').in('post_id', postIds),
    ]);

  const nameById = Object.fromEntries((profiles || []).map((p) => [p.id, p.name]));
  const likeCount: Record<string, number> = {};
  const likedByMe = new Set<string>();
  for (const row of likes || []) {
    likeCount[row.post_id] = (likeCount[row.post_id] || 0) + 1;
    if (row.user_id === userId) likedByMe.add(row.post_id);
  }
  const commentCount: Record<string, number> = {};
  for (const row of comments || []) {
    commentCount[row.post_id] = (commentCount[row.post_id] || 0) + 1;
  }

  return posts.map((p) => ({
    ...p,
    authorName: nameById[p.user_id] || 'Member',
    authorPhoto: photos[p.user_id] ?? null,
    likeCount: likeCount[p.id] || 0,
    commentCount: commentCount[p.id] || 0,
    likedByMe: likedByMe.has(p.id),
  }));
}

export async function createTextPost(userId: string, content: string): Promise<void> {
  const { error } = await supabase.from('posts').insert({
    user_id: userId,
    type: 'text',
    content: content.trim(),
  });
  if (error) throw error;
}

export async function togglePostLike(
  postId: string,
  userId: string,
  currentlyLiked: boolean
): Promise<void> {
  if (currentlyLiked) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('post_likes')
      .insert({ post_id: postId, user_id: userId });
    if (error) throw error;
  }
}

export async function fetchComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('id, post_id, user_id, content, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const userIds = [...new Set((data || []).map((c) => c.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = Object.fromEntries((profiles || []).map((p) => [p.id, p.name]));
  return (data || []).map((c) => ({
    ...c,
    authorName: nameById[c.user_id] || 'Member',
  }));
}

export async function addComment(
  postId: string,
  userId: string,
  content: string
): Promise<void> {
  const { error } = await supabase.from('comments').insert({
    post_id: postId,
    user_id: userId,
    content: content.trim(),
  });
  if (error) throw error;
}
