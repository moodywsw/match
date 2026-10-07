import { supabase } from './supabase';

export type Interest = {
  id: number;
  category: 'music' | 'food' | 'lifestyle' | 'movies' | string;
  label: string;
};

export async function fetchAllInterests(): Promise<Interest[]> {
  const { data, error } = await supabase
    .from('interests')
    .select('id, category, label')
    .order('category', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchUserInterestIds(userId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('user_interests')
    .select('interest_id')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []).map((r) => r.interest_id as number);
}

export async function fetchInterestLabelsForUsers(
  userIds: string[]
): Promise<Record<string, string[]>> {
  if (!userIds.length) return {};
  const { data, error } = await supabase
    .from('user_interests')
    .select('user_id, interest_id, interests(label)')
    .in('user_id', userIds);
  if (error) {
    // Fallback without embed if relationship name differs
    console.warn('[match] interest join failed, falling back', error.message);
    const { data: rows, error: e2 } = await supabase
      .from('user_interests')
      .select('user_id, interest_id')
      .in('user_id', userIds);
    if (e2) throw e2;
    const ids = [...new Set((rows || []).map((r) => r.interest_id))];
    const { data: catalog } = await supabase
      .from('interests')
      .select('id, label')
      .in('id', ids);
    const labelById = Object.fromEntries((catalog || []).map((i) => [i.id, i.label]));
    const map: Record<string, string[]> = {};
    for (const row of rows || []) {
      const label = labelById[row.interest_id];
      if (!label) continue;
      if (!map[row.user_id]) map[row.user_id] = [];
      map[row.user_id].push(label);
    }
    return map;
  }

  const map: Record<string, string[]> = {};
  for (const row of data || []) {
    const interest = row.interests as unknown as { label: string } | null;
    const label = interest?.label;
    if (!label) continue;
    if (!map[row.user_id]) map[row.user_id] = [];
    map[row.user_id].push(label);
  }
  return map;
}

/** Replace the caller's interest set (delete missing, insert new). */
export async function setUserInterests(
  userId: string,
  interestIds: number[]
): Promise<void> {
  const unique = [...new Set(interestIds)];
  const { error: delError } = await supabase
    .from('user_interests')
    .delete()
    .eq('user_id', userId);
  if (delError) throw delError;
  if (!unique.length) return;
  const { error } = await supabase.from('user_interests').insert(
    unique.map((interest_id) => ({ user_id: userId, interest_id }))
  );
  if (error) throw error;
}
