import type { RealtimeChannel } from '@supabase/supabase-js';

import { fetchPrimaryPhotos } from './profile';
import { pushLatestNotification } from './push';
import { supabase } from './supabase';

/**
 * 1:1 calls between two matches.
 *
 * Signalling = public.calls rows (RLS: only the two parties can read) + Realtime
 * postgres_changes. Every state change goes through SECURITY DEFINER RPCs
 * (start_call / answer_call / end_call / call_heartbeat). Media = LiveKit room
 * `match-call-<id>`; the token comes from the `livekit-token` edge function
 * (`{ call_id }`), which only serves the two members and never when blocked.
 */

export type CallKind = 'video' | 'audio';
export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended';
export type CallRow = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  kind: CallKind;
  status: CallStatus;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
};
export type CallPeer = { id: string; name: string; photo: string | null };

/** Server-side ring timeout is 45 s (private.expire_calls); the caller hangs up a hair earlier. */
export const RING_TIMEOUT_MS = 44_000;
export const CALL_COLS = 'id, conversation_id, caller_id, callee_id, kind, status, created_at, answered_at, ended_at';

export const isFinal = (s: CallStatus | string | null | undefined) => s === 'declined' || s === 'missed' || s === 'ended';

export async function startCall(conversationId: string, kind: CallKind): Promise<string> {
  const { data, error } = await supabase.rpc('start_call', {
    p_conversation_id: conversationId,
    p_kind: kind,
  });
  if (error) throw error;
  return data as string;
}

export async function answerCall(callId: string, accept: boolean): Promise<CallStatus> {
  const { data, error } = await supabase.rpc('answer_call', {
    p_call_id: callId,
    p_accept: accept,
  });
  if (error) throw error;
  return data as CallStatus;
}

export async function endCall(callId: string): Promise<CallStatus> {
  const { data, error } = await supabase.rpc('end_call', { p_call_id: callId });
  if (error) throw error;
  return data as CallStatus;
}

export async function callHeartbeat(callId: string): Promise<CallStatus | null> {
  const { data, error } = await supabase.rpc('call_heartbeat', {
    p_call_id: callId,
  });
  if (error) return null;
  return data as CallStatus;
}

export async function fetchCall(callId: string): Promise<CallRow | null> {
  const { data } = await supabase.from('calls').select(CALL_COLS).eq('id', callId).maybeSingle();
  return (data as CallRow | null) ?? null;
}

/** A call that is still ringing for me (app opened from a push / came to foreground). */
export async function fetchRingingForMe(userId: string): Promise<CallRow | null> {
  const since = new Date(Date.now() - 45_000).toISOString();
  const { data } = await supabase
    .from('calls')
    .select(CALL_COLS)
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as CallRow | undefined) ?? null;
}

export async function fetchCallPeer(userId: string): Promise<CallPeer> {
  const [{ data }, photos] = await Promise.all([
    supabase.from('profiles').select('id, name').eq('id', userId).maybeSingle(),
    fetchPrimaryPhotos([userId]).catch(() => ({}) as Record<string, string | null>),
  ]);
  return {
    id: userId,
    name: (data?.name as string) || 'Your match',
    photo: photos[userId] ?? null,
  };
}

export type CallTokenResult =
  | { ok: true; token: string; url: string; kind: CallKind }
  | {
      ok: false;
      reason: 'not_configured' | 'call_ended' | 'not_allowed' | 'rate_limited' | 'error';
    };

export async function fetchCallToken(callId: string): Promise<CallTokenResult> {
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { call_id: callId },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 503) return { ok: false, reason: 'not_configured' };
    if (status === 410) return { ok: false, reason: 'call_ended' };
    if (status === 403) return { ok: false, reason: 'not_allowed' };
    if (status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'error' };
  }
  const d = data as { token?: string; url?: string; kind?: CallKind };
  if (!d?.token || !d.url) return { ok: false, reason: 'error' };
  return {
    ok: true,
    token: d.token,
    url: d.url,
    kind: d.kind === 'audio' ? 'audio' : 'video',
  };
}

/** Incoming calls for me (RLS lets only the two parties see a row). */
export function subscribeIncomingCalls(userId: string, onRing: (c: CallRow) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`calls-in:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `callee_id=eq.${userId}`,
      },
      (p) => {
        const row = p.new as CallRow;
        if (row?.status === 'ringing') onRing(row);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Status changes of one call (accept / decline / hang-up from the other side). */
export function subscribeCall(callId: string, onChange: (c: CallRow) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`call:${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${callId}`,
      },
      (p) => onChange(p.new as CallRow),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** The caller's client pushes the missed-call notification that end_call just wrote. */
export function pushMissedCall(calleeId: string) {
  void pushLatestNotification(calleeId);
}

export function callErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('busy')) return 'They’re on another call — try again in a bit';
  if (msg.includes('rate_limited')) return 'Too many call attempts — try again in a few minutes';
  if (msg.includes('not_allowed')) return "You can't call this person";
  if (msg.includes('call_ended')) return 'This call has ended';
  return 'Call failed — check your connection';
}

export function callDurationLabel(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
