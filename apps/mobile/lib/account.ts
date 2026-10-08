import { supabase } from './supabase';

/**
 * Permanently delete the signed-in account via the `delete-account` Edge
 * Function (service role lives only in the function). Cascades all user data
 * and removes their Storage files. Store subscriptions must be cancelled in
 * App Store / Google Play separately.
 */
export async function deleteMyAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) msg = String(body.error);
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg || 'Could not delete account');
  }
  if (!data?.ok) throw new Error('Could not delete account');
}
