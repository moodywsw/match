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
 * Discover excludes blocked_id for the current user via fetchBlockedIds.
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
