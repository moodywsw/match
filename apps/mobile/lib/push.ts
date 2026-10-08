import { supabase } from './supabase';

/**
 * Ask the send-push Edge Function to notify a matched user.
 * Uses the caller's session JWT (verify_jwt). Fails soft — chat must not break.
 */
export async function notifyUserPush(params: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: {
        user_id: params.userId,
        title: params.title,
        body: params.body,
        data: params.data ?? {},
      },
    });
    if (error) {
      console.warn('[match] send-push invoke failed', error.message);
    }
  } catch (err) {
    console.warn('[match] send-push invoke error', err);
  }
}

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
