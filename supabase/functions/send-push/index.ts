import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * send-push — look up public.push_tokens for a user and call Expo Push API.
 *
 * Auth (verify_jwt = true at the gateway):
 *  - Authorization: Bearer <service_role JWT>  → may notify any user_id
 *  - Authorization: Bearer <user access token> → may notify user_id only if
 *    a match exists between the caller and that user (e.g. after a chat message)
 *
 * Notification mode — body `{ "notification_for": "<user_id>" }`:
 *    pushes the newest un-pushed public.notifications row (≤ 2 min old) whose
 *    user_id is the target and whose actor_id is the caller. The row is written
 *    by DB triggers (match, message, post_like, comment, story_reply), so the
 *    caller cannot forge content: title/body are built here from that row.
 *
 * Expo Push API accepts ExponentPushToken[...] without an Expo account secret.
 * Do not put Expo or service-role secrets in git; SUPABASE_* are injected by the runtime.
 */

type PushBody = {
  user_id?: string;
  notification_for?: string;
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

  const targetUserId = payload.user_id?.trim();
  if (!targetUserId) {
    return json({ error: "user_id is required" }, 400);
  }

  const title = payload.title?.trim() || "Match";
  const bodyText = payload.body?.trim() || "You have a new notification";
  const data = payload.data ?? {};

  const admin = createClient(supabaseUrl, serviceKey);

  if (role === "service_role") {
    // Trusted server / webhook path — any user_id allowed.
  } else if (role === "authenticated") {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Invalid user JWT" }, 401);
    }
    const callerId = userData.user.id;
    if (callerId === targetUserId) {
      return json({ error: "Cannot push to yourself via user JWT" }, 400);
    }
    const { data: matchRow, error: matchError } = await admin
      .from("matches")
      .select("id")
      .or(
        `and(user_a.eq.${callerId},user_b.eq.${targetUserId}),and(user_a.eq.${targetUserId},user_b.eq.${callerId})`,
      )
      .maybeSingle();
    if (matchError) {
      return json({ error: matchError.message }, 500);
    }
    if (!matchRow) {
      return json(
        { error: "Caller is not matched with target user_id" },
        403,
      );
    }
  } else {
    return json({ error: `Unsupported JWT role: ${role}` }, 403);
  }

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
