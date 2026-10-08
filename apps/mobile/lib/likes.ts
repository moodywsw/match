import { supabase } from './supabase';

export type ReceivedLike = {
  likerId: string;
  name: string;
  age: number | null;
  city: string | null;
  isSuperLike: boolean;
  likedAt: string;
};

export async function fetchLikesReceivedCount(): Promise<number> {
  const { data, error } = await supabase.rpc('get_likes_received_count');
  if (error) throw error;
  return Number(data) || 0;
}

export async function fetchLikesReceived(): Promise<ReceivedLike[]> {
  const { data, error } = await supabase.rpc('get_likes_received');
  if (error) throw error;
  return ((data || []) as { liker_id: string; name: string; birth_date: string | null; city: string | null; is_super_like: boolean; liked_at: string }[]).map(
    (r) => ({
      likerId: r.liker_id,
      name: r.name,
      age: r.birth_date ? Math.floor((Date.now() - new Date(r.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000)) : null,
      city: r.city,
      isSuperLike: !!r.is_super_like,
      likedAt: r.liked_at,
    }),
  );
}
