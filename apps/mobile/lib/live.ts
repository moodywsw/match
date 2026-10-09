import type { RealtimeChannel } from '@supabase/supabase-js';

import { fetchPrimaryPhotos } from './profile';
import { supabase } from './supabase';
import { friendlyError } from './errors';

/**
 * Live rooms — all state is server-backed (supabase/migrations/20261008_live_rooms.sql):
 *  - start_live / end_live / join_live (heartbeat) / leave_live RPCs
 *  - get_live_rooms (active, block-filtered, with live viewer counts)
 *  - get_live_state (status, viewers, reactions, LIVE MATCH votes)
 *  - public.live_messages (RLS + rate limited) streamed via Realtime
 *  - send_live_reaction / vote_live_match RPCs
 * Real video uses LiveKit; tokens come from the `livekit-token` edge function.
 */

export const LIVE_HEARTBEAT_MS = 25_000;
export const LIVE_STATE_POLL_MS = 5_000;

export type LiveRoomRow = {
  id: string;
  host_id: string;
  host_name: string | null;
  guest_id: string | null;
  guest_name: string | null;
  title: string;
  category: string;
  is_live_match: boolean;
  started_at: string;
  viewers: number;
  reactions: number;
  is_mine: boolean;
};

export type LiveState = {
  status: 'live' | 'ended';
  viewers: number;
  reactions: number;
  yes_votes: number;
  no_votes: number;
  my_vote: boolean | null;
};

export type LiveChatLine = { id: string; userId: string; user: string; text: string; createdAt: string };

export type LiveRole = 'host' | 'guest' | 'viewer';

export type LiveTokenResult =
  | { ok: true; token: string; url: string; room: string; canPublish: boolean }
  | { ok: false; reason: 'not_configured' | 'stream_ended' | 'not_allowed' | 'error'; message?: string };

export async function fetchLiveRooms(category?: string | null): Promise<(LiveRoomRow & { host_photo: string | null; guest_photo: string | null })[]> {
  const { data, error } = await supabase.rpc('get_live_rooms', {
    p_category: category && category !== 'Trending' ? category : null,
  });
  if (error) throw error;
  const rows = (data || []) as LiveRoomRow[];
  const ids = [...new Set(rows.flatMap((r) => [r.host_id, r.guest_id].filter(Boolean) as string[]))];
  const photos = ids.length ? await fetchPrimaryPhotos(ids).catch(() => ({} as Record<string, string>)) : {};
  return rows.map((r) => ({
    ...r,
    host_photo: photos[r.host_id] ?? null,
    guest_photo: r.guest_id ? photos[r.guest_id] ?? null : null,
  }));
}

export async function startLive(title: string, category: string, guestId?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('start_live', {
    p_title: title.trim().slice(0, 80) || 'Untitled live',
    p_category: category,
    p_guest_id: guestId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function endLive(streamId: string): Promise<void> {
  const { error } = await supabase.rpc('end_live', { p_stream_id: streamId });
  if (error) throw error;
}

/** Join (or heartbeat). Call every LIVE_HEARTBEAT_MS while the room is open. */
export async function joinLive(streamId: string): Promise<LiveRole> {
  const { data, error } = await supabase.rpc('join_live', { p_stream_id: streamId });
  if (error) throw error;
  return data as LiveRole;
}

export async function leaveLive(streamId: string): Promise<void> {
  await supabase.rpc('leave_live', { p_stream_id: streamId });
}

export async function fetchLiveState(streamId: string): Promise<LiveState | null> {
  const { data, error } = await supabase.rpc('get_live_state', { p_stream_id: streamId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as LiveState | undefined;
  return row ?? null;
}

export async function sendLiveReaction(streamId: string, count = 1): Promise<number | null> {
  const { data, error } = await supabase.rpc('send_live_reaction', { p_stream_id: streamId, p_count: count });
  if (error) throw error;
  return (data as number) ?? null;
}

export async function voteLiveMatch(streamId: string, yes: boolean): Promise<void> {
  const { error } = await supabase.rpc('vote_live_match', { p_stream_id: streamId, p_yes: yes });
  if (error) throw error;
}

async function namesFor(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data } = await supabase.from('profiles').select('id, name').in('id', ids);
  return Object.fromEntries((data || []).map((p) => [p.id as string, (p.name as string) || 'Member']));
}

export async function fetchLiveChat(streamId: string, limit = 40): Promise<LiveChatLine[]> {
  const { data, error } = await supabase
    .from('live_messages')
    .select('id, user_id, body, created_at')
    .eq('stream_id', streamId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data || []).reverse();
  const names = await namesFor([...new Set(rows.map((r) => r.user_id as string))]);
  return rows.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    user: names[r.user_id as string] || 'Member',
    text: r.body as string,
    createdAt: r.created_at as string,
  }));
}

export async function sendLiveChat(streamId: string, text: string): Promise<{ id: string; createdAt: string } | null> {
  const body = text.trim().slice(0, 200);
  if (!body) return null;
  const { data, error } = await supabase
    .from('live_messages')
    .insert({ stream_id: streamId, body })
    .select('id, created_at')
    .single();
  if (error) throw error;
  return { id: data.id as string, createdAt: data.created_at as string };
}

/**
 * Realtime for one room: new chat lines (postgres_changes, RLS-filtered) and
 * ephemeral reaction bursts (broadcast) so everyone sees floating hearts.
 */
export function subscribeLiveRoom(
  streamId: string,
  handlers: { onChat: (line: LiveChatLine) => void; onReaction: (count: number) => void }
): { sendReactionBurst: (count: number) => void; unsubscribe: () => void } {
  const nameCache: Record<string, string> = {};
  const channel: RealtimeChannel = supabase
    .channel(`live:${streamId}`, { config: { broadcast: { self: false } } })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'live_messages', filter: `stream_id=eq.${streamId}` },
      async (payload) => {
        const r = payload.new as { id: string; user_id: string; body: string; created_at: string };
        if (!nameCache[r.user_id]) Object.assign(nameCache, await namesFor([r.user_id]));
        handlers.onChat({ id: r.id, userId: r.user_id, user: nameCache[r.user_id] || 'Member', text: r.body, createdAt: r.created_at });
      }
    )
    .on('broadcast', { event: 'reaction' }, (msg) => {
      const n = Number((msg.payload as { count?: number })?.count) || 1;
      handlers.onReaction(Math.min(20, Math.max(1, n)));
    })
    .subscribe();
  return {
    sendReactionBurst: (count) => {
      void channel.send({ type: 'broadcast', event: 'reaction', payload: { count } });
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

/** Ask the `livekit-token` edge function for a room token (503 until LiveKit secrets are set). */
export async function fetchLiveKitToken(streamId: string): Promise<LiveTokenResult> {
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { stream_id: streamId } });
  if (error) {
    const ctx = (error as { context?: { status?: number } }).context;
    const status = ctx?.status;
    if (status === 503) return { ok: false, reason: 'not_configured' };
    if (status === 410) return { ok: false, reason: 'stream_ended' };
    if (status === 403) return { ok: false, reason: 'not_allowed' };
    return { ok: false, reason: 'error', message: error.message };
  }
  const d = data as { token?: string; url?: string; room?: string; canPublish?: boolean };
  if (!d?.token || !d.url) return { ok: false, reason: 'error' };
  return { ok: true, token: d.token, url: d.url, room: d.room ?? '', canPublish: !!d.canPublish };
}

export function liveErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('rate_limited')) return "Slow down a little — try again in a moment";
  if (msg.includes('stream_ended')) return 'This live has ended';
  if (msg.includes('guest_not_allowed')) return 'You can only invite one of your matches';
  if (msg.includes('not_allowed')) return "You can't join this live";
  if (msg.includes('cannot_vote_own')) return "You can't vote on your own LIVE MATCH";
  if (msg.includes('not_host')) return 'Only the host can end this live';
  if (msg.includes('live_messages_body_check') || msg.includes('check constraint')) return 'Messages must be 1–200 characters';
  return friendlyError(err, 'Something went wrong with this live — try again');
}
