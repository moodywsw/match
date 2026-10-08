import { supabase } from './supabase';

/**
 * Push the notification the DB trigger just wrote for `targetUserId` because of
 * the caller's action (match, message, post like, comment, story reply).
 * send-push builds the text server-side from that row. Fails soft.
 */
export async function pushLatestNotification(targetUserId: string | null | undefined): Promise<void> {
  if (!targetUserId || targetUserId.startsWith('demo-')) return;
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: { notification_for: targetUserId },
    });
    if (error) console.warn('[match] send-push (notification) failed', error.message);
  } catch (err) {
    console.warn('[match] send-push (notification) error', err);
  }
}
