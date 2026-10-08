/**
 * Map server-side guard errors (RLS, rate limits, check constraints) to short user-facing copy.
 * Server raises P0001 with a code as the message (e.g. `rate_limited`, detail = action).
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong — try again'): string {
  const e = err as { message?: string; code?: string; details?: string } | null;
  const msg = e?.message || (typeof err === 'string' ? err : '');
  if (!msg) return fallback;
  if (msg.includes('rate_limited')) return "You're doing that a lot — take a short break and try again";
  if (msg.includes('photo_limit')) return 'You can have up to 9 photos';
  if (msg.includes('violates check constraint') || e?.code === '23514') return "That's too long or not allowed — please shorten it";
  if (msg.includes('row-level security') || e?.code === '42501') return "You can't do that";
  if (msg.includes('Failed to fetch') || msg.includes('Network request failed')) return 'No connection — check your internet';
  return msg.length > 120 ? fallback : msg;
}
