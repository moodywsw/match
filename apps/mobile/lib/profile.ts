import { supabase } from './supabase';

export type Profile = {
  id: string;
  name: string;
  birth_date: string;
  gender: string | null;
  city: string | null;
  bio: string | null;
  intention: string | null;
  verified: boolean;
  is_discoverable: boolean;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
};

/** Default DOB ~25 years ago — required NOT NULL on profiles. */
export function defaultBirthDate(age = 25): string {
  const year = new Date().getFullYear() - age;
  return `${year}-06-15`;
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, name, birth_date, gender, city, bio, intention, verified, is_discoverable, onboarding_complete, created_at, updated_at'
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
      'id, name, birth_date, gender, city, bio, intention, verified, is_discoverable, onboarding_complete, created_at, updated_at'
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
