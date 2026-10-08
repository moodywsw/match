import { fetchInterestLabelsForUsers } from './interests';
import { supabase } from './supabase';

export type Profile = {
  id: string;
  name: string;
  birth_date: string;
  gender: string | null;
  city: string | null;
  bio: string | null;
  intention: string | null;
  friday_answer?: string | null;
  verified: boolean;
  is_discoverable: boolean;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
};

export type DiscoverProfile = {
  id: string;
  name: string;
  birth_date: string | null;
  city: string | null;
  bio: string | null;
  intention: string | null;
  verified: boolean;
  is_discoverable: boolean;
  /** Whole km computed server-side from ~1.5 km grid cells (null = hidden/unknown). */
  distanceKm: number | null;
  fridayAnswer: string | null;
  photoUrl: string | null;
  age: number | null;
  interests: string[];
  /** false for local demo cards that must not hit public.likes */
  isLive: boolean;
  /** Has an active boost (30 min at the top of Discover). */
  boosted?: boolean;
  /** Super liked the viewer (shown first + highlighted). */
  superLikedMe?: boolean;
};

/** Server-side deck filters. Advanced fields are ignored by the RPC for free users. */
export type DeckFilters = {
  includePassed?: boolean;
  maxKm?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  verifiedOnly?: boolean;
  intention?: string | null;
};

export type MatchRow = {
  id: string;
  user_a: string;
  user_b: string;
  created_at?: string;
};

/** Default DOB ~25 years ago — required NOT NULL on profiles. */
/** A birth date that yields exactly `age` today (DB enforces 18+). */
export function defaultBirthDate(age = 25): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function ageFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

export const INTENTION_LABELS: Record<string, string> = {
  serious: 'Serious relationship',
  casual: 'Casual dating',
  new_people: 'New people',
  friendship: 'Friendship',
  figuring_out: 'Still figuring it out',
};

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, name, birth_date, gender, city, bio, intention, friday_answer, verified, is_discoverable, onboarding_complete, created_at, updated_at'
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertOwnProfile(
  userId: string,
  fields: Partial<Omit<Profile, 'id' | 'created_at'>> & {
    name?: string;
    birth_date?: string;
  }
): Promise<Profile> {
  const payload = {
    id: userId,
    updated_at: new Date().toISOString(),
    ...fields,
  };
  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select(
      'id, name, birth_date, gender, city, bio, intention, friday_answer, verified, is_discoverable, onboarding_complete, created_at, updated_at'
    )
    .single();
  if (error) throw error;
  return data;
}

/** Ensure a profiles row exists after first sign-in / sign-up. */
export async function ensureProfileStub(
  userId: string,
  email?: string | null
): Promise<Profile> {
  const existing = await fetchOwnProfile(userId);
  if (existing) return existing;

  const nameFromEmail = email?.split('@')[0]?.trim() || 'New member';
  return upsertOwnProfile(userId, {
    name: nameFromEmail,
    birth_date: defaultBirthDate(25),
    onboarding_complete: false,
    is_discoverable: false,
  });
}

export async function fetchPrimaryPhotos(
  userIds: string[]
): Promise<Record<string, string>> {
  if (!userIds.length) return {};
  const { data, error } = await supabase
    .from('photos')
    .select('user_id, url, is_primary, position')
    .in('user_id', userIds)
    .order('position', { ascending: true });
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data || []) {
    const uid = row.user_id as string;
    if (!map[uid] || row.is_primary) {
      map[uid] = row.url as string;
    }
  }
  return map;
}

/**
 * Load the swipe deck via the `get_discover_deck` RPC (SECURITY INVOKER, RLS applies).
 * Server excludes self / liked / passed / blocked / incognito, applies filters
 * (advanced ones only for MATCH+) and orders super-likers and boosted users first.
 */
export async function fetchDiscoverDeck(
  _userId: string,
  filters: DeckFilters = {},
  limit = 40
): Promise<DiscoverProfile[]> {
  const { data, error } = await supabase.rpc('get_discover_deck', {
    p_limit: limit,
    p_include_passed: !!filters.includePassed,
    p_max_km: filters.maxKm ?? null,
    p_min_age: filters.minAge ?? null,
    p_max_age: filters.maxAge ?? null,
    p_verified_only: !!filters.verifiedOnly,
    p_intention: filters.intention ?? null,
  });
  if (error) throw error;
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
    boosted: boolean | null;
    super_liked_me: boolean | null;
  };
  const rows = (data || []) as Row[];
  const ids = rows.map((r) => r.id);
  const [photos, interestMap] = await Promise.all([
    fetchPrimaryPhotos(ids),
    fetchInterestLabelsForUsers(ids),
  ]);

  return rows.map((r) => ({
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
    photoUrl: photos[r.id] ?? null,
    age: ageFromBirthDate(r.birth_date),
    interests: interestMap[r.id] ?? [],
    isLive: true,
    boosted: !!r.boosted,
    superLikedMe: !!r.super_liked_me,
  }));
}

/** Persist a pass server-side (enables rewind + keeps it out of the deck). */
export async function recordPass(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('record_pass', { p_target: targetId });
  if (error) throw error;
}

export async function findMatchBetween(
  userA: string,
  userB: string
): Promise<MatchRow | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, user_a, user_b, created_at')
    .or(
      `and(user_a.eq.${userA},user_b.eq.${userB}),and(user_a.eq.${userB},user_b.eq.${userA})`
    )
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Insert a like. Match rows are created only by the DB trigger — we only
 * re-read `matches` afterwards to detect mutual likes.
 */
export async function sendLike(
  likerId: string,
  likedId: string,
  isSuperLike = false
): Promise<{ like: { id: string }; match: MatchRow | null }> {
  const { data, error } = await supabase
    .from('likes')
    .insert({
      liker_id: likerId,
      liked_id: likedId,
      is_super_like: isSuperLike,
    })
    .select('id')
    .single();
  if (error) throw error;

  // Trigger runs AFTER INSERT; a short delay is usually unnecessary but
  // re-query once. If null, try once more shortly after.
  let match = await findMatchBetween(likerId, likedId);
  if (!match) {
    await new Promise((r) => setTimeout(r, 150));
    match = await findMatchBetween(likerId, likedId);
  }

  return { like: data, match };
}

/** Local-only demo cards when the live deck is empty. */
export function demoDiscoverProfiles(): DiscoverProfile[] {
  return [
    {
      id: 'demo-alex',
      name: 'Alex',
      birth_date: defaultBirthDate(27),
      city: 'Lisbon',
      bio: 'Vinyl, late dinners, and bad puns. Demo card — not in Supabase.',
      intention: 'serious',
      verified: true,
      is_discoverable: true,
      distanceKm: null,
      fridayAnswer: null,
      photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&q=80',
      age: 27,
      interests: ['Indie', 'Coffee', 'Live concerts'],
      isLive: false,
    },
    {
      id: 'demo-maya',
      name: 'Maya',
      birth_date: defaultBirthDate(24),
      city: 'Porto',
      bio: 'Design, hiking, matcha. Demo card for empty discovery.',
      intention: 'new_people',
      verified: false,
      is_discoverable: true,
      distanceKm: null,
      fridayAnswer: null,
      photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80',
      age: 24,
      interests: ['Hiking', 'Photography', 'Coffee'],
      isLive: false,
    },
    {
      id: 'demo-jordan',
      name: 'Jordan',
      birth_date: defaultBirthDate(29),
      city: 'Faro',
      bio: 'Live music and road trips. Demo only.',
      intention: 'casual',
      verified: true,
      is_discoverable: true,
      distanceKm: null,
      fridayAnswer: null,
      photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
      age: 29,
      interests: ['Live concerts', 'Travel'],
      isLive: false,
    },
  ];
}

export type PrivacySettings = {
  show_online_status: boolean;
  read_receipts: boolean;
  show_distance: boolean;
  is_discoverable: boolean;
  who_can_message: 'everyone' | 'matches';
};

export async function fetchPrivacySettings(userId: string): Promise<PrivacySettings | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('show_online_status, read_receipts, show_distance, is_discoverable, who_can_message')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as PrivacySettings | null;
}

export async function updatePrivacySettings(
  userId: string,
  fields: Partial<PrivacySettings>
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
