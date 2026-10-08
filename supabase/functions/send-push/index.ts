import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * send-push — look up public.push_tokens for a user and call Expo Push API.
 *
 * Auth (verify_jwt = true at the gateway):
 *  - Authorization: Bearer <service_role JWT>  → free-form mode `{ user_id, title, body }`
 *    may notify any user (trusted server paths only)
 *  - Authorization: Bearer <user access token> → only the notification / event modes below,
 *    where the text is built here from DB rows the caller can't forge (no free-form
 *    title/body from clients — that would let a match send arbitrary push content).
 * All ids are validated as UUIDs before they reach a query filter.
 *
 * Notification mode — body `{ "notification_for": "<user_id>" }`:
 *    pushes the newest un-pushed public.notifications row (≤ 2 min old) whose
 *    user_id is the target and whose actor_id is the caller. The row is written
 *    by DB triggers (match, message, post_like, comment, story_reply, super_like,
 *    story_like), so the caller cannot forge content: title/body are built here from that row.
 *
 * Event mode — body `{ "event_notifications": "<event_id>" }`:
 *    pushes every un-pushed event_update / event_cancelled row (≤ 2 min old) for that
 *    event whose actor_id is the caller (the event creator) to each attendee.
 *
 * Expo Push API accepts ExponentPushToken[...] without an Expo account secret.
 * Do not put Expo or service-role secrets in git; SUPABASE_* are injected by the runtime.
 */

type PushBody = {
  user_id?: string;
  notification_for?: string;
  event_notifications?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
};

type ExpoPushMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v.trim());

function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7);
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: "Missing Supabase runtime env" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  const role = decodeJwtRole(authHeader);
  if (!authHeader || !role) {
    return json({ error: "Missing or invalid Authorization bearer JWT" }, 401);
  }

  let payload: PushBody;
  try {
    payload = (await req.json()) as PushBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (payload.event_notifications !== undefined && !isUuid(payload.event_notifications)) {
    return json({ error: "event_notifications must be a uuid" }, 400);
  }
  if (payload.notification_for !== undefined && !isUuid(payload.notification_for)) {
    return json({ error: "notification_for must be a uuid" }, 400);
  }

  if (payload.event_notifications) {
    return await pushEventNotifications(
      supabaseUrl,
      serviceKey,
      anonKey,
      authHeader,
      role,
      payload.event_notifications.trim(),
    );
  }

  if (payload.notification_for) {
    return await pushFromNotification(
      supabaseUrl,
      serviceKey,
      anonKey,
      authHeader,
      role,
      payload.notification_for.trim(),
    );
  }

  // Free-form mode: trusted server callers only.
  if (role !== "service_role") {
    return json({ error: "free-form pushes require the service role; use notification_for" }, 403);
  }
  const targetUserId = payload.user_id?.trim();
  if (!isUuid(targetUserId)) {
    return json({ error: "user_id (uuid) is required" }, 400);
  }

  const title = (payload.title?.trim() || "Match").slice(0, 80);
  const bodyText = (payload.body?.trim() || "You have a new notification").slice(0, 200);
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: tokens, error: tokenError } = await admin
    .from("push_tokens")
    .select("token, platform")
    .eq("user_id", targetUserId);

  if (tokenError) {
    return json({ error: tokenError.message }, 500);
  }

  const expoTokens = (tokens ?? [])
    .map((t) => t.token as string)
    .filter((t) => typeof t === "string" && t.length > 0);

  if (expoTokens.length === 0) {
    return json({
      ok: true,
      sent: 0,
      message: "No push_tokens for user_id",
    });
  }

  const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
    to,
    title,
    body: bodyText,
    data,
    sound: payload.sound === null ? null : "default",
  }));

  return await sendExpo(messages);
});

async function sendExpo(messages: ExpoPushMessage[]): Promise<Response> {
  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const expoJson = await expoRes.json().catch(() => null);
  if (!expoRes.ok) {
    return json(
      {
        error: "Expo Push API error",
        status: expoRes.status,
        details: expoJson,
      },
      502,
    );
  }

  return json({
    ok: true,
    sent: messages.length,
    tickets: expoJson,
  });
}

type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  payload: Record<string, unknown> | null;
};

function describe(n: NotificationRow, actorName: string): { title: string; body: string } {
  const preview = typeof n.payload?.preview === "string" ? (n.payload.preview as string) : "";
  switch (n.type) {
    case "match":
      return { title: "It's a match! 🔥", body: `You and ${actorName} liked each other` };
    case "message":
      return { title: actorName, body: preview || "Sent you a message" };
    case "post_like":
      return { title: "MATCH", body: `${actorName} liked your post` };
    case "comment":
      return { title: "MATCH", body: preview ? `${actorName} commented: ${preview}` : `${actorName} commented on your post` };
    case "story_reply":
      return { title: "MATCH", body: preview ? `${actorName} replied to your story: ${preview}` : `${actorName} replied to your story` };
    case "super_like":
      return { title: "⭐ Super like", body: `${actorName} super liked you — they'll be first in your Discover` };
    case "story_like":
      return { title: "MATCH", body: `${actorName} liked your story` };
    case "event_update": {
      const title = typeof n.payload?.title === "string" ? (n.payload.title as string) : "An event";
      const changes = Array.isArray(n.payload?.changes) ? (n.payload!.changes as string[]) : [];
      const what = changes.includes("time") ? "new time" : changes.includes("place") ? "new place" : "updated";
      return { title: `📅 ${title}`, body: `${actorName} changed the event (${what}) — tap for details` };
    }
    case "event_cancelled": {
      const title = typeof n.payload?.title === "string" ? (n.payload.title as string) : "An event";
      return { title: `❌ ${title}`, body: `${actorName} cancelled this event` };
    }
    default:
      return { title: "MATCH", body: "You have a new notification" };
  }
}

async function pushFromNotification(
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  authHeader: string,
  role: string,
  targetUserId: string,
): Promise<Response> {
  if (role !== "authenticated") {
    return json({ error: "notification_for requires a user JWT" }, 403);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Invalid user JWT" }, 401);
  }
  const callerId = userData.user.id;
  const admin = createClient(supabaseUrl, serviceKey);

  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("notifications")
    .select("id, user_id, actor_id, type, payload")
    .eq("user_id", targetUserId)
    .eq("actor_id", callerId)
    .is("pushed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return json({ error: error.message }, 500);
  const n = (rows ?? [])[0] as NotificationRow | undefined;
  if (!n) return json({ ok: true, sent: 0, message: "No pending notification" });

  // Claim it first so retries / races do not double-push.
  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ pushed_at: new Date().toISOString() })
    .eq("id", n.id)
    .is("pushed_at", null)
    .select("id");
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed?.length) return json({ ok: true, sent: 0, message: "Already pushed" });

  const [{ data: actor }, { data: tokens, error: tokenError }] = await Promise.all([
    admin.from("profiles").select("name").eq("id", callerId).maybeSingle(),
    admin.from("push_tokens").select("token").eq("user_id", targetUserId),
  ]);
  if (tokenError) return json({ error: tokenError.message }, 500);
  const expoTokens = (tokens ?? [])
    .map((t) => t.token as string)
    .filter((t) => typeof t === "string" && t.length > 0);
  if (!expoTokens.length) return json({ ok: true, sent: 0, message: "No push_tokens for user_id" });

  const { title, body } = describe(n, (actor?.name as string) || "Someone");
  const data: Record<string, unknown> = { type: n.type, notification_id: n.id, ...(n.payload ?? {}) };
  delete data.preview;
  return await sendExpo(
    expoTokens.map((to) => ({ to, title, body, data, sound: "default" as const })),
  );
}

async function pushEventNotifications(
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  authHeader: string,
  role: string,
  eventId: string,
): Promise<Response> {
  if (role !== "authenticated") {
    return json({ error: "event_notifications requires a user JWT" }, 403);
  }
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json({ error: "Invalid event id" }, 400);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Invalid user JWT" }, 401);
  const callerId = userData.user.id;
  const admin = createClient(supabaseUrl, serviceKey);

  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("notifications")
    .select("id, user_id, actor_id, type, payload")
    .eq("actor_id", callerId)
    .in("type", ["event_update", "event_cancelled"])
    .eq("payload->>event_id", eventId)
    .is("pushed_at", null)
    .gte("created_at", since)
    .limit(500);
  if (error) return json({ error: error.message }, 500);
  const pending = (rows ?? []) as NotificationRow[];
  if (!pending.length) return json({ ok: true, sent: 0, message: "No pending notifications" });

  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ pushed_at: new Date().toISOString() })
    .in("id", pending.map((n) => n.id))
    .is("pushed_at", null)
    .select("id");
  if (claimError) return json({ error: claimError.message }, 500);
  const claimedIds = new Set((claimed ?? []).map((c) => c.id as string));
  const mine = pending.filter((n) => claimedIds.has(n.id));
  if (!mine.length) return json({ ok: true, sent: 0, message: "Already pushed" });

  const [{ data: actor }, { data: tokens, error: tokenError }] = await Promise.all([
    admin.from("profiles").select("name").eq("id", callerId).maybeSingle(),
    admin.from("push_tokens").select("user_id, token").in("user_id", mine.map((n) => n.user_id)),
  ]);
  if (tokenError) return json({ error: tokenError.message }, 500);
  const actorName = (actor?.name as string) || "The host";
  const byUser = new Map<string, NotificationRow>(mine.map((n) => [n.user_id, n]));
  const messages: ExpoPushMessage[] = [];
  for (const t of tokens ?? []) {
    const n = byUser.get(t.user_id as string);
    const to = t.token as string;
    if (!n || !to) continue;
    const { title, body } = describe(n, actorName);
    messages.push({ to, title, body, sound: "default", data: { type: n.type, notification_id: n.id, ...(n.payload ?? {}) } });
  }
  if (!messages.length) return json({ ok: true, sent: 0, message: "No push_tokens for attendees" });
  // Expo accepts up to 100 messages per request.
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const res = await sendExpo(messages.slice(i, i + 100));
    if (res.status !== 200) return res;
    sent += Math.min(100, messages.length - i);
  }
  return json({ ok: true, sent });
}
