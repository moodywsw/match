import { supabase } from './supabase';

/** Server-tracked state of a match (public.match_lifecycle, read-only for clients). */
export type Lifecycle = {
  matchId: string;
  state: 'active' | 'expiring' | 'expired';
  matchedAt: string;
  lastMessageAt: string | null;
  expiresAt: string | null;
  extendedByMe: boolean;
  videoSuggestedAt: string | null;
  nudgedAt: string | null;
};

type Row = {
  match_id: string;
  user_a: string;
  user_b: string;
  state: Lifecycle['state'];
  matched_at: string;
  last_message_at: string | null;
  expires_at: string | null;
  extended_a_at: string | null;
  extended_b_at: string | null;
  video_suggested_at: string | null;
  nudged_at: string | null;
};
const COLS = 'match_id, user_a, user_b, state, matched_at, last_message_at, expires_at, extended_a_at, extended_b_at, video_suggested_at, nudged_at';

function toLifecycle(r: Row, me: string): Lifecycle {
  return {
    matchId: r.match_id,
    state: r.state,
    matchedAt: r.matched_at,
    lastMessageAt: r.last_message_at,
    expiresAt: r.expires_at,
    extendedByMe: me === r.user_a ? !!r.extended_a_at : !!r.extended_b_at,
    videoSuggestedAt: r.video_suggested_at,
    nudgedAt: r.nudged_at,
  };
}

export async function fetchLifecycles(matchIds: string[], me: string): Promise<Record<string, Lifecycle>> {
  if (!matchIds.length) return {};
  const { data, error } = await supabase.from('match_lifecycle').select(COLS).in('match_id', matchIds);
  if (error) throw error;
  return Object.fromEntries(((data || []) as Row[]).map((r) => [r.match_id, toLifecycle(r, me)]));
}

export async function fetchLifecycle(matchId: string, me: string): Promise<Lifecycle | null> {
  const map = await fetchLifecycles([matchId], me);
  return map[matchId] ?? null;
}

/** 2–3 AI-free conversation starters built server-side from what you share. */
export async function fetchStarters(conversationId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_conversation_starters', { p_conversation_id: conversationId });
  if (error) throw error;
  return Array.isArray(data) ? (data as string[]) : [];
}

/** Extend an expiring match (once per person). Returns the new expiry. */
export async function extendMatch(matchId: string): Promise<string> {
  const { data, error } = await supabase.rpc('extend_match', { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

/** Hours until `iso` as "47h 12m" / "12m". */
export function timeLeftLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

/* ------------------------------ dates ------------------------------ */

export type DateState = { iMarked: boolean; theyMarked: boolean; feedbackDone: boolean };

export async function fetchDateState(matchId: string, me: string): Promise<DateState> {
  const [{ data: marks, error }, { data: fb, error: fbErr }] = await Promise.all([
    supabase.from('date_confirmations').select('user_id').eq('match_id', matchId),
    supabase.from('date_feedback').select('id').eq('match_id', matchId).eq('rater_id', me).limit(1),
  ]);
  if (error) throw error;
  if (fbErr) throw fbErr;
  const ids = (marks || []).map((m) => m.user_id as string);
  return { iMarked: ids.includes(me), theyMarked: ids.some((x) => x !== me), feedbackDone: !!fb?.length };
}

export async function markWeMet(matchId: string): Promise<{ them: boolean; notified: boolean }> {
  const { data, error } = await supabase.rpc('mark_we_met', { p_match_id: matchId });
  if (error) throw error;
  const d = (data ?? {}) as { them?: boolean; notified?: boolean };
  return { them: !!d.them, notified: !!d.notified };
}

export type DateFeedback = {
  lookedLikePhotos: 'yes' | 'mostly' | 'no';
  feltSafe: boolean;
  meetAgain: 'yes' | 'maybe' | 'no';
  note?: string;
};

export async function submitDateFeedback(matchId: string, f: DateFeedback): Promise<void> {
  const { error } = await supabase.rpc('submit_date_feedback', {
    p_match_id: matchId,
    p_looked_like_photos: f.lookedLikePhotos,
    p_felt_safe: f.feltSafe,
    p_meet_again: f.meetAgain,
    p_note: f.note?.trim() ? f.note.trim().slice(0, 1000) : null,
  });
  if (error) throw error;
}
