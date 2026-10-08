/**
 * Premium perks — thin wrappers over server RPCs (all quota / tier checks are
 * enforced in Postgres; see supabase/migrations/20261008_premium_perks.sql).
 *
 * Error codes raised by the server (P0001 message): premium_required,
 * nothing_to_rewind, already_matched, boost_active, boost_quota.
 */
import { ageFromBirthDate } from './profile';
import { supabase } from './supabase';

export function perkErrorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? '');
  for (const code of ['premium_required', 'nothing_to_rewind', 'already_matched', 'boost_active', 'boost_quota', 'daily_like_limit', 'super_like_limit']) {
    if (msg.includes(code)) return code;
  }
  return msg || 'unknown_error';
}

/* ---------- rewind (MATCH+) ---------- */
export type RewindResult = { kind: 'like' | 'pass'; targetId: string };

export async function rewindLastSwipe(): Promise<RewindResult> {
  const { data, error } = await supabase.rpc('rewind_last_swipe');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { kind: string; target_id: string } | undefined;
  if (!row) throw new Error('nothing_to_rewind');
  return { kind: row.kind === 'like' ? 'like' : 'pass', targetId: row.target_id };
}

/* ---------- boost (MATCH+: 1 / month, 30 min) ---------- */
export type BoostStatus = { activeUntil: string | null; usedThisMonth: number; monthlyQuota: number };

export async function fetchBoostStatus(): Promise<BoostStatus> {
  const { data, error } = await supabase.rpc('get_boost_status');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { active_until: string | null; used_this_month: number; monthly_quota: number }
    | undefined;
  return {
    activeUntil: row?.active_until ?? null,
    usedThisMonth: Number(row?.used_this_month) || 0,
    monthlyQuota: Number(row?.monthly_quota) || 0,
  };
}

export async function activateBoost(): Promise<string> {
  const { data, error } = await supabase.rpc('activate_boost');
  if (error) throw error;
  return data as string;
}

/* ---------- profile views (count: everyone; list: SUPER MATCH) ---------- */
export async function recordProfileView(viewedId: string): Promise<void> {
  const { error } = await supabase.rpc('record_profile_view', { p_viewed: viewedId });
  if (error) throw error;
}

export async function fetchProfileViewersCount(): Promise<number> {
  const { data, error } = await supabase.rpc('get_profile_viewers_count');
  if (error) throw error;
  return Number(data) || 0;
}

export type ProfileViewer = { viewerId: string; name: string; age: number | null; city: string | null; viewedAt: string };

export async function fetchProfileViewers(): Promise<ProfileViewer[]> {
  const { data, error } = await supabase.rpc('get_profile_viewers');
  if (error) throw error;
  return ((data || []) as { viewer_id: string; name: string; birth_date: string | null; city: string | null; viewed_at: string }[]).map((r) => ({
    viewerId: r.viewer_id,
    name: r.name,
    age: ageFromBirthDate(r.birth_date),
    city: r.city,
    viewedAt: r.viewed_at,
  }));
}

/* ---------- incognito (SUPER MATCH; enforced by trigger + RLS) ---------- */
export async function fetchIncognito(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('incognito').eq('id', userId).maybeSingle();
  if (error) throw error;
  return !!(data as { incognito?: boolean } | null)?.incognito;
}

export async function setIncognito(userId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ incognito: on, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw error;
}
