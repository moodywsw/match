import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

/**
 * livekit-token — issue a LiveKit room access token for a Match live stream.
 *
 * Auth: verify_jwt = true at the gateway, and the caller's JWT is forwarded to
 * Postgres. `public.get_live_token_grant(stream_id)` decides everything:
 *  - the stream must be active (not ended, heartbeat < 2 min)  → 410 stream_ended
 *  - the caller must not be blocked by / blocking host or guest → 403 not_allowed
 *  - host & LIVE MATCH guest get canPublish; everyone else subscribe-only.
 *
 * Secrets (never in git; set with `supabase secrets set ...`):
 *   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL (wss://<project>.livekit.cloud)
 * If any is missing the function answers 503 `livekit_not_configured`.
 *
 * Request:  POST { "stream_id": "<uuid>" }   — live room
 *       or  POST { "call_id": "<uuid>" }     — 1:1 call between two matches
 *           (`public.get_call_token_grant`: only the caller/callee, never when
 *           blocked, only while ringing (caller) or accepted → 410 call_ended)
 * Response: { token, url, room, identity, canPublish, expiresAt }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_TTL_SECONDS = 2 * 60 * 60;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${b64url(sig)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const liveKitUrl = Deno.env.get("LIVEKIT_URL");
  if (!apiKey || !apiSecret || !liveKitUrl) {
    return json({ error: "livekit_not_configured" }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let streamId: unknown;
  let callId: unknown;
  try {
    const body = await req.json();
    streamId = body?.stream_id;
    callId = body?.call_id;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const isCall = callId !== undefined && callId !== null;
  if (isCall) {
    if (typeof callId !== "string" || !UUID_RE.test(callId)) return json({ error: "invalid_call_id" }, 400);
  } else if (typeof streamId !== "string" || !UUID_RE.test(streamId)) {
    return json({ error: "invalid_stream_id" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const { data, error } = isCall
    ? await supabase.rpc("get_call_token_grant", { p_call_id: callId })
    : await supabase.rpc("get_live_token_grant", { p_stream_id: streamId });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("stream_ended")) return json({ error: "stream_ended" }, 410);
    if (msg.includes("call_ended")) return json({ error: "call_ended" }, 410);
    if (msg.includes("rate_limited")) return json({ error: "rate_limited" }, 429);
    if (msg.includes("not_allowed")) return json({ error: "not_allowed" }, 403);
    if (msg.includes("not_authenticated")) return json({ error: "unauthorized" }, 401);
    console.error(isCall ? "get_call_token_grant failed" : "get_live_token_grant failed", error);
    return json({ error: "grant_failed" }, 500);
  }
  const grant = Array.isArray(data) ? data[0] : data;
  if (!grant?.room || grant.identity !== userData.user.id) {
    return json({ error: "not_allowed" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + (isCall ? 4 * 60 * 60 : TOKEN_TTL_SECONDS);
  const canPublish = grant.can_publish === true;
  const sources = !canPublish ? [] : isCall && grant.kind === "audio" ? ["microphone"] : ["camera", "microphone"];
  const token = await signHs256({
    iss: apiKey,
    sub: grant.identity,
    name: String(grant.display_name ?? "Member").slice(0, 60),
    nbf: now - 10,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
    video: {
      room: grant.room,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: sources,
    },
  }, apiSecret);

  return json({
    token,
    url: liveKitUrl,
    room: grant.room,
    identity: grant.identity,
    canPublish,
    kind: isCall ? grant.kind : undefined,
    expiresAt: new Date(exp * 1000).toISOString(),
  });
});
