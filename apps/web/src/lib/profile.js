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

// Own private columns (birth_date, gender, settings) are not selectable on the table for
// anyone; the get_my_profile RPC returns only the caller's full row.
export async function fetchOwnProfile(_userId) {
  const { data, error } = await supabase.rpc("get_my_profile").maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertOwnProfile(userId, fields) {
  const payload = {
    id: userId,
    updated_at: new Date().toISOString(),
    ...fields,
  };
  delete payload.verified;
  // Update first, insert when missing (an ON CONFLICT upsert needs SELECT on private columns).
  const { id, ...fieldsOnly } = payload;
  const { data: updated, error: updErr } = await supabase.from("profiles").update(fieldsOnly).eq("id", id).select("id");
  if (updErr) throw updErr;
  if (!updated?.length) {
    const { error: insErr } = await supabase.from("profiles").insert(payload);
    if (insErr) throw insErr;
  }
  return fetchOwnProfile(userId);
}

// Server-side deck (excludes self, liked, blocked, hidden). birth_date in the result is an
// age anchor (same age, not the real date of birth).
export async function fetchDiscoverableProfiles(_excludeUserId, limit = 40) {
  const { data, error } = await supabase.rpc("get_discover_deck", { p_limit: limit });
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
