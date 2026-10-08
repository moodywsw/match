import { supabase } from "./supabase.js";

export const INTENTION_TO_DB = {
  "Serious relationship": "serious",
  "Casual dating": "casual",
  "New people": "new_people",
  "Friendship": "friendship",
  "Still figuring it out": "figuring_out",
};

export const INTENTION_FROM_DB = Object.fromEntries(
  Object.entries(INTENTION_TO_DB).map(([label, value]) => [value, label])
);

export function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

export function birthDateFromAge(age = 25) {
  const year = new Date().getFullYear() - Number(age);
  return `${year}-06-15`;
}

export async function fetchOwnProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertOwnProfile(userId, fields) {
  const payload = {
    id: userId,
    updated_at: new Date().toISOString(),
    ...fields,
  };
  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function fetchDiscoverableProfiles(excludeUserId, limit = 40) {
  let query = supabase
    .from("profiles")
    .select("id, name, birth_date, city, bio, intention, verified, is_discoverable")
    .eq("is_discoverable", true)
    .eq("onboarding_complete", true)
    .limit(limit);

  if (excludeUserId) {
    query = query.neq("id", excludeUserId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchPrimaryPhotos(userIds) {
  if (!userIds?.length) return {};
  const { data, error } = await supabase
    .from("photos")
    .select("user_id, url, is_primary, position")
    .in("user_id", userIds)
    .order("position", { ascending: true });
  if (error) throw error;
  const map = {};
  for (const row of data || []) {
    if (!map[row.user_id] || row.is_primary) {
      map[row.user_id] = row.url;
    }
  }
  return map;
}

export async function sendLike(likerId, likedId, isSuperLike = false) {
  const { data, error } = await supabase
    .from("likes")
    .insert({ liker_id: likerId, liked_id: likedId, is_super_like: isSuperLike })
    .select("*")
    .single();
  if (error) throw error;

  const { data: matchRow } = await supabase
    .from("matches")
    .select("id, user_a, user_b")
    .or(
      `and(user_a.eq.${likerId},user_b.eq.${likedId}),and(user_a.eq.${likedId},user_b.eq.${likerId})`
    )
    .maybeSingle();

  return { like: data, match: matchRow || null };
}

export async function fetchMyMatches(userId) {
  const { data, error } = await supabase
    .from("matches")
    .select("id, user_a, user_b, created_at")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
