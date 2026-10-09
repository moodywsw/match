/**
 * Map server-side guard errors (RLS, rate limits, check constraints, auth) to short
 * user-facing copy. Server functions raise P0001 with a snake_case code as the message
 * (e.g. `rate_limited`). Anything that still looks technical falls back to `fallback`
 * so users never see raw Postgres / Supabase text.
 */

const CODES: Record<string, string> = {
  rate_limited: "You're doing that a lot — take a short break and try again",
  photo_limit: 'You can have up to 9 photos',
  must_be_18: 'You need to be 18 or older to use MATCH',
  not_authenticated: 'Your session expired — please sign in again',
  not_allowed: "You can't do that",
  not_owner: "You can't do that",
  blocked: "You can't interact with this person",
  daily_like_limit: "You're out of likes for today — MATCH+ is unlimited",
  super_like_limit: 'No super likes left today',
  event_full: 'This event is full',
  event_cancelled: 'This event was cancelled',
  stream_ended: 'This live has ended',
  insufficient_coins: 'Not enough coins — top up in your wallet',
  busy: 'They’re on another call — try again in a bit',
  call_ended: 'This call has ended',
};

const TECHNICAL = /violates|relation|column|function|syntax|permission denied|duplicate key|null value|invalid input|PGRST|JWT|jwt|schema|constraint|operator|uuid|SQLSTATE|FetchError|TypeError|undefined|null is not|Cannot read/i;

/** True when the user simply backed out (picker/purchase cancelled) — show nothing. */
export function isCancelled(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '');
  return /^(cancell?ed|canceled)$/i.test(msg.trim()) || /user ?cancel/i.test(msg);
}

export function friendlyError(err: unknown, fallback = 'Something went wrong — try again'): string {
  const e = err as { message?: string; code?: string; details?: string; status?: number } | null;
  const msg = (e?.message || (typeof err === 'string' ? err : '')).trim();
  if (!msg) return fallback;
  for (const [code, text] of Object.entries(CODES)) if (msg.includes(code)) return text;
  if (/Failed to fetch|Network request failed|network error|timed? ?out|ECONN|fetch failed/i.test(msg)) return 'No connection — check your internet and try again';
  if (msg.includes('JWT expired') || e?.code === 'PGRST301') return 'Your session expired — please sign in again';
  if (e?.code === '23505' || msg.includes('duplicate key')) return "That's already done";
  if (e?.code === '23514' || msg.includes('violates check constraint')) return "That's too long or not allowed — please shorten it";
  if (msg.includes('row-level security') || e?.code === '42501') return "You can't do that";
  if (msg.includes('Payload too large') || msg.includes('exceeded the maximum allowed size')) return 'That file is too big';
  // Bare server codes (snake_case) we don't know, or anything technical → fallback.
  if (/^[a-z0-9_]+$/.test(msg) || TECHNICAL.test(msg) || msg.length > 120) return fallback;
  return msg;
}

/** Supabase Auth errors → plain English. */
export function authErrorMessage(err: { message?: string; code?: string; status?: number } | null | undefined, fallback = 'Something went wrong — try again'): string {
  const msg = err?.message ?? '';
  const code = err?.code ?? '';
  if (!msg && !code) return fallback;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already been registered/i.test(msg)) return 'An account with this email already exists — sign in instead.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox.';
  if (code === 'weak_password' || /password should|password is too weak|at least \d+ characters/i.test(msg)) return 'Choose a stronger password — at least 8 characters.';
  if (code === 'same_password' || /different from the old password/i.test(msg)) return 'Your new password must be different from the old one.';
  if (code === 'over_email_send_rate_limit' || /email rate limit|security purposes, you can only request/i.test(msg)) return 'Too many emails sent — wait a few minutes and try again.';
  if (code === 'over_request_rate_limit' || /rate limit|too many requests/i.test(msg) || err?.status === 429) return 'Too many attempts — wait a minute and try again.';
  if (code === 'validation_failed' || /unable to validate email|invalid format|email address .* is invalid/i.test(msg)) return 'That email address doesn’t look right.';
  if (code === 'otp_expired' || /expired|invalid.*(token|link)/i.test(msg)) return 'This link has expired — request a new one.';
  if (code === 'session_not_found' || /auth session missing/i.test(msg)) return 'Your session expired — please sign in again.';
  if (code === 'signup_disabled') return 'Sign-ups are paused right now.';
  return friendlyError(err, fallback);
}
