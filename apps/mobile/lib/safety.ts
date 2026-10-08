import { supabase } from './supabase';

export const REPORT_CATEGORIES = [
  'spam',
  'harassment',
  'inappropriate',
  'fake_profile',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * Block a user. RLS only lets you insert as blocker.
 * Discover excludes blocked peers (either direction) server-side in get_discover_deck.
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error('Cannot block yourself');
  const { error } = await supabase.from('blocks').upsert(
    { blocker_id: blockerId, blocked_id: blockedId },
    { onConflict: 'blocker_id,blocked_id' }
  );
  if (error) throw error;
}

export async function reportUser(params: {
  reporterId: string;
  reportedId: string;
  category: ReportCategory | string;
  details?: string;
}): Promise<void> {
  if (params.reporterId === params.reportedId) {
    throw new Error('Cannot report yourself');
  }
  const { error } = await supabase.from('reports').insert({
    reporter_id: params.reporterId,
    reported_id: params.reportedId,
    category: params.category,
    details: params.details?.trim() || null,
  });
  if (error) throw error;
}

/** General "Report a problem" (no specific person) → report queue as category app_problem. */
export async function reportProblem(reporterId: string, topic: string, details: string): Promise<void> {
  const text = [topic, details.trim()].filter(Boolean).join(' — ').slice(0, 1000);
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_id: null,
    category: 'app_problem',
    details: text || null,
  });
  if (error) throw error;
}

export type BlockedRow = { blocked_id: string; name: string; created_at: string };

export async function fetchMyBlocks(blockerId: string): Promise<BlockedRow[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id, created_at')
    .eq('blocker_id', blockerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const ids = (data || []).map((r) => r.blocked_id as string);
  if (!ids.length) return [];
  const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', ids);
  const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.name]));
  return (data || []).map((r) => ({
    blocked_id: r.blocked_id as string,
    created_at: r.created_at as string,
    name: names[r.blocked_id as string] || 'Member',
  }));
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}
