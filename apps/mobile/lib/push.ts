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
