import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * delete-account — in-app account deletion (App Store guideline 5.1.1(v),
 * Google Play account deletion policy).
 *
 * verify_jwt = true: the caller's own access token identifies the account.
 * Body: { "confirm": "DELETE" }.
 *
 * 1. Removes the user's Storage objects (profile photos, stories, chat media
 *    they sent). Uses the service role, which only exists in the function env.
 * 2. Deletes the auth user → public.profiles and every user-owned row cascade
 *    (likes, matches → conversations → messages, stories, posts, push tokens,
 *    subscriptions, payments, …).
 *
 * Store subscriptions are NOT cancelled by deleting the account — the user must
 * cancel in App Store / Google Play settings (the app tells them so).
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function listAll(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error || !data?.length) break;
      for (const item of data) {
        const path = dir ? `${dir}/${item.name}` : item.name;
        // Folders have no id in the Storage list API.
        if (item.id === null || item.id === undefined) await walk(path);
        else out.push(path);
      }
      if (data.length < 1000) break;
    }
  };
  await walk(prefix);
  return out;
}

async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) console.error("storage remove", bucket, error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let body: { confirm?: string } = {};
  try {
    body = await req.json();
  } catch { /* empty body */ }
  if (body.confirm !== "DELETE") return json({ error: "confirmation_required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: "unauthorized" }, 401);

  try {
    // Chat media lives at {conversation_id}/{sender_id}/… — find this user's conversations.
    const { data: matches } = await admin
      .from("matches")
      .select("id")
      .or(`user_a.eq.${uid},user_b.eq.${uid}`);
    const matchIds = (matches ?? []).map((m) => m.id as string);
    let convIds: string[] = [];
    if (matchIds.length) {
      const { data: convs } = await admin.from("conversations").select("id").in("match_id", matchIds);
      convIds = (convs ?? []).map((c) => c.id as string);
    }

    const [photos, stories, ...chat] = await Promise.all([
      listAll(admin, "profile-photos", uid),
      listAll(admin, "story-media", uid),
      ...convIds.map((c) => listAll(admin, "chat-media", `${c}/${uid}`)),
    ]);
    await removeAll(admin, "profile-photos", photos);
    await removeAll(admin, "story-media", stories);
    await removeAll(admin, "chat-media", chat.flat());

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw delErr;

    return json({ ok: true, removed_files: photos.length + stories.length + chat.flat().length });
  } catch (e) {
    console.error("delete-account error", uid, e);
    return json({ error: "delete_failed" }, 500);
  }
});
