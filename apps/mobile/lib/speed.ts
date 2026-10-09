import { friendlyError } from './errors';
import { missingText } from './live';
import { supabase } from './supabase';

/**
 * Speed Dating (1:1 video dates with a server-side queue) and group dating rooms.
 * Everything is server-authoritative: pairing, the 2-minute timer, coin charges/refunds and the
 * private Match/Pass picks all live in Postgres (see supabase/migrations/20261009_speed_dating.sql
 * and 20261009_group_dating.sql). The client just polls the status RPCs.
 */

export const SPEED_POLL_MS = 3_000;

export type SpeedNight = { active: boolean; starts_at: string; ends_at: string };
export type SpeedPartner = { id: string; name: string; age: number | null; photo: string | null; intention: string | null; verified: boolean };
export type SpeedSession = {
  id: string;
  status: 'pending' | 'live' | 'deciding' | 'done' | 'cancelled';
  created_at: string;
  started_at: string | null;
  ends_at: string | null;
  ready_deadline: string;
  decide_deadline: string | null;
  refund_until: string | null;
  me_ready: boolean;
  partner_ready: boolean;
  partner_left: boolean;
  my_choice: 'match' | 'pass' | null;
  outcome: 'match' | 'no_match' | null;
  ended_reason: string | null;
  refunded: boolean;
  match_id: string | null;
  conversation_id: string | null;
  shared_interest: string | null;
  icebreaker: string | null;
  partner: SpeedPartner;
};
export type SpeedStatus = {
  state: 'idle' | 'queued' | 'session';
  session: SpeedSession | null;
  queued_at: string | null;
  waiting: number;
  price: number;
  free_today: boolean;
  seconds: number;
  refund_seconds: number;
  coins: number;
  block: string | null;
  missing: string[];
  night: SpeedNight | null;
};
export type SpeedPrefs = { minAge: number; maxAge: number; maxKm: number | null; sameIntention: boolean };
export const DEFAULT_SPEED_PREFS: SpeedPrefs = { minAge: 18, maxAge: 99, maxKm: null, sameIntention: false };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const fetchSpeedStatus = () => rpc<SpeedStatus>('speed_status');
export const fetchSpeedNight = () => rpc<SpeedNight>('get_speed_night');
export const joinSpeed = (p: SpeedPrefs) =>
  rpc<SpeedStatus>('speed_join', { p_min_age: p.minAge, p_max_age: p.maxAge, p_max_km: p.maxKm, p_same_intention: p.sameIntention });
export const leaveSpeedQueue = () => rpc<SpeedStatus>('speed_leave_queue');
export const speedReady = (id: string) => rpc<SpeedSession>('speed_ready', { p_session: id });
export const speedLeave = (id: string, reason: 'left' | 'report' = 'left') => rpc<SpeedSession>('speed_leave', { p_session: id, p_reason: reason });
export const speedChoose = (id: string, choice: 'match' | 'pass') => rpc<SpeedSession>('speed_choose', { p_session: id, p_choice: choice });

// ---------------------------------------------------------------------------
// group rooms
export type GroupMode = 'roulette' | 'friends' | 'interests';
export type GroupMember = {
  id: string;
  name: string;
  age: number | null;
  photo: string | null;
  verified: boolean;
  intention: string | null;
  is_me: boolean;
  is_host: boolean;
  here: boolean;
  picked: boolean;
  matched: boolean;
};
export type GroupMatch = { id: string; name: string; photo: string | null; match_id: string | null; conversation_id: string | null };
export type GroupRoom = {
  id: string;
  mode: GroupMode;
  title: string;
  status: 'open' | 'live' | 'picking' | 'done' | 'cancelled';
  ended_reason: string | null;
  interest: { id: number; label: string; category: string } | null;
  is_host: boolean;
  created_at: string;
  started_at: string | null;
  ends_at: string | null;
  picks_until: string | null;
  max: number;
  min: number;
  here: number;
  members: GroupMember[];
  picks_done: boolean;
  left: boolean;
  matches: GroupMatch[] | null;
  invites: { id: string; name: string; status: 'pending' | 'accepted' | 'declined' }[] | null;
  invited?: string[];
};
export type GroupInvite = { room_id: string; title: string; host: { id: string; name: string; photo: string | null }; created_at: string };
export type GroupLobby = {
  current: GroupRoom | null;
  invites: GroupInvite[];
  interest_rooms: { room_id: string; interest_id: number; label: string; status: string; here: number; mine: boolean }[];
  my_interests: { id: number; label: string }[];
  block: string | null;
  missing: string[];
  max: number;
  live_minutes: number;
};

export const fetchGroupLobby = () => rpc<GroupLobby>('group_lobby');
export const joinGroup = (mode: 'roulette' | 'interests', p: SpeedPrefs, interestId: number | null = null) =>
  rpc<GroupRoom>('group_join', { p_mode: mode, p_interest: interestId, p_min_age: p.minAge, p_max_age: p.maxAge, p_max_km: p.maxKm });
export const createFriendsRoom = (title: string, invitees: string[]) => rpc<GroupRoom>('group_create_friends', { p_title: title, p_invitees: invitees });
export const respondGroupInvite = (roomId: string, accept: boolean) => rpc<GroupRoom | { declined: true }>('group_respond_invite', { p_room: roomId, p_accept: accept });
export const startGroup = (roomId: string) => rpc<GroupRoom>('group_start', { p_room: roomId });
export const fetchGroupStatus = (roomId: string) => rpc<GroupRoom>('group_status', { p_room: roomId });
export const leaveGroup = (roomId: string) => rpc<GroupRoom>('group_leave', { p_room: roomId });
export const pickInGroup = (roomId: string, picked: string[]) => rpc<GroupRoom>('group_pick', { p_room: roomId, p_picked: picked });

/** Push the invite notifications created by group_create_friends (best effort, one per invitee). */
export async function pushGroupInvites(userIds: string[]): Promise<void> {
  await Promise.all(
    userIds.map((id) => supabase.functions.invoke('send-push', { body: { notification_for: id } }).catch(() => undefined))
  );
}

// ---------------------------------------------------------------------------
// LiveKit token for a speed date / group room
export type RoomTokenResult =
  | { ok: true; token: string; url: string; room: string }
  | { ok: false; reason: 'not_configured' | 'ended' | 'not_allowed' | 'error' };

export async function fetchRoomToken(kind: 'speed' | 'group', id: string): Promise<RoomTokenResult> {
  const body = kind === 'speed' ? { speed_id: id } : { group_id: id };
  const { data, error } = await supabase.functions.invoke('livekit-token', { body });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 503) return { ok: false, reason: 'not_configured' };
    if (status === 410) return { ok: false, reason: 'ended' };
    if (status === 403) return { ok: false, reason: 'not_allowed' };
    return { ok: false, reason: 'error' };
  }
  const d = data as { token?: string; url?: string; room?: string };
  if (!d?.token || !d.url) return { ok: false, reason: 'error' };
  return { ok: true, token: d.token, url: d.url, room: d.room ?? '' };
}

// ---------------------------------------------------------------------------
// copy helpers
export function secondsLeft(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Fri 21:00" style label in the user's locale timezone; the event itself is 21:00 Lisbon. */
export function nightLabel(n: SpeedNight | null | undefined, now = Date.now()): string | null {
  if (!n) return null;
  if (n.active) return 'Speed Dating Night is on now';
  const start = new Date(n.starts_at).getTime();
  const hrs = (start - now) / 3_600_000;
  if (hrs <= 0) return null;
  if (hrs < 1) return `Speed Dating Night starts in ${Math.max(1, Math.round(hrs * 60))} min`;
  if (hrs < 24) return `Speed Dating Night tonight at 21:00`;
  return 'Speed Dating Night · Fridays 21:00 (Lisbon)';
}

export function endedText(s: SpeedSession): string {
  switch (s.ended_reason) {
    case 'partner_left_early':
      return s.partner_left ? `${s.partner.name} left early${s.refunded ? ' — your coins are back' : ''}.` : 'You left early — your date was refunded.';
    case 'no_show':
      return s.me_ready ? `${s.partner.name} didn't show up${s.refunded ? ' — your coins are back' : ''}.` : "You didn't join in time.";
    case 'reported':
      return 'This date was ended after a report. Thanks for keeping MATCH safe.';
    case 'blocked':
      return 'This date was cancelled.';
    default:
      return 'This date has ended.';
  }
}

export function speedErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg.includes('insufficient_coins')) return 'Not enough coins — tap Top up';
  if (msg.includes('profile_incomplete')) {
    const detail = (err as { details?: string })?.details;
    return `${detail ? missingText(detail.split(',')) : 'Complete your profile'} to start dating live`;
  }
  if (msg.includes('incognito_speed') || msg.includes('incognito_group')) return 'Turn off incognito to join speed dating';
  if (msg.includes('already_in_session')) return "You're already in a date";
  if (msg.includes('already_in_room')) return "You're already in a group room — leave it first";
  if (msg.includes('invalid_preferences')) return 'Check your age and distance preferences';
  if (msg.includes('not_deciding')) return 'Picks open when the date ends';
  if (msg.includes('not_picking')) return 'Picks open when the room ends';
  if (msg.includes('need_more_people')) return 'Wait for at least one friend to join';
  if (msg.includes('no_invitees')) return 'Pick at least one of your matches to invite';
  if (msg.includes('too_many_invitees')) return 'Up to 9 friends per room';
  if (msg.includes('room_full')) return 'This room is full';
  if (msg.includes('room_closed')) return 'This room has already ended';
  if (msg.includes('rate_limited')) return 'Slow down a little — try again in a moment';
  if (msg.includes('not_host')) return 'Only the host can do that';
  if (msg.includes('not_allowed')) return "You can't join this one";
  return friendlyError(err, 'Something went wrong — try again');
}
