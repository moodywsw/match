import { ageFromBirthDate, hydratePeople, type DiscoverProfile } from './profile';
import { supabase } from './supabase';

export type Pick = DiscoverProfile & { reason: string; rank: number; acted: 'like' | 'pass' | null };
export type DailyPicks = { pickDate: string | null; refreshesAt: string | null; quota: number; picks: Pick[] };

type Row = {
  id: string;
  name: string;
  birth_date: string | null;
  city: string | null;
  bio: string | null;
  intention: string | null;
  verified: boolean | null;
  friday_answer: string | null;
  distance_km: number | null;
  super_liked_me: boolean | null;
  reason: string;
  rank: number;
  acted: 'like' | 'pass' | null;
};

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Today's curated picks. Generated server-side on the first call of the user's local day
 * (compatibility-ranked, tier quota) and persisted for the day.
 */
export async function fetchDailyPicks(): Promise<DailyPicks> {
  const { data, error } = await supabase.rpc('get_daily_picks', { p_tz: deviceTimeZone() });
  if (error) throw error;
  const d = (data ?? {}) as { pick_date?: string | null; refreshes_at?: string | null; quota?: number; picks?: Row[] };
  const rows = Array.isArray(d.picks) ? d.picks : [];
  const { photos, interestMap, trust } = rows.length ? await hydratePeople(rows.map((r) => r.id)) : { photos: {}, interestMap: {}, trust: {} as Record<string, boolean> };
  return {
    pickDate: d.pick_date ?? null,
    refreshesAt: d.refreshes_at ?? null,
    quota: Number(d.quota ?? 0),
    picks: rows.map((r) => ({
      id: r.id,
      name: r.name,
      birth_date: r.birth_date,
      city: r.city,
      bio: r.bio,
      intention: r.intention,
      verified: !!r.verified,
      is_discoverable: true,
      distanceKm: r.distance_km == null ? null : Number(r.distance_km),
      fridayAnswer: r.friday_answer,
      photoUrl: (photos as Record<string, string>)[r.id] ?? null,
      age: ageFromBirthDate(r.birth_date),
      interests: (interestMap as Record<string, string[]>)[r.id] ?? [],
      isLive: true,
      boosted: false,
      superLikedMe: !!r.super_liked_me,
      realPhotos: !!trust[r.id],
      reason: r.reason,
      rank: r.rank,
      acted: r.acted,
    })),
  };
}

/** "08:12:33" until `iso` (never negative). */
export function countdownLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return '--:--:--';
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
