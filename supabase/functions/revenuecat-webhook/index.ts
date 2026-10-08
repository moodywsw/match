import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * revenuecat-webhook — the ONLY writer of public.subscriptions / public.payments.
 *
 * Deployed with verify_jwt = false: RevenueCat cannot send a Supabase JWT, so
 * auth is the shared secret RevenueCat puts in the Authorization header
 * (RevenueCat dashboard → Integrations → Webhooks → "Authorization header value").
 * The same value must be set as a Supabase secret:
 *
 *   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<value> --project-ref pkpdheytmbwvqhpcaigm
 *
 * Until it is set every request is rejected (503), so nothing can be forged.
 *
 * Optional: REVENUECAT_SECRET_API_KEY (RevenueCat secret key, sk_…) lets TRANSFER
 * events re-sync the receiving user's entitlements from the RevenueCat REST API.
 *
 * The app sets the RevenueCat appUserID to the Supabase auth user id (uuid).
 *
 * MATCH coins (consumables coins_100 / coins_550 / coins_1200, listed in
 * public.coin_packs) are handled before the subscription logic:
 *   NON_RENEWING_PURCHASE → public.credit_coin_purchase (idempotent per store transaction id)
 *   CANCELLATION (refund)  → public.reverse_coin_purchase (claws back what is left)
 * Both are SECURITY DEFINER functions executable by service_role only, so the
 * coin balance can never be raised by a client.
 */

type RcEvent = {
  id: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  entitlement_ids?: string[] | null;
  entitlement_id?: string | null;
  period_type?: string;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
  environment?: "SANDBOX" | "PRODUCTION";
  store?: string;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  transferred_from?: string[];
  transferred_to?: string[];
  cancel_reason?: string;
};

type Tier = "match_plus" | "super_match";
type Status = "active" | "canceled" | "expired" | "in_grace_period";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  return timingSafeEqual(header, secret) || timingSafeEqual(header, `Bearer ${secret}`);
}

function mapStore(store?: string): string {
  switch ((store ?? "").toUpperCase()) {
    case "APP_STORE":
    case "MAC_APP_STORE":
      return "app_store";
    case "PLAY_STORE":
      return "play_store";
    case "AMAZON":
      return "amazon";
    case "STRIPE":
    case "RC_BILLING":
      return "stripe";
    case "PROMOTIONAL":
      return "promotional";
    case "TEST_STORE":
      return "test_store";
    default:
      return "other";
  }
}

function tierFor(entitlements: string[] | null | undefined, productId?: string): Tier {
  const ids = (entitlements ?? []).map((e) => e.toLowerCase());
  if (ids.includes("super_match")) return "super_match";
  if (ids.includes("match_plus")) return "match_plus";
  return (productId ?? "").toLowerCase().includes("super") ? "super_match" : "match_plus";
}

function iso(ms?: number | null): string | null {
  return typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;
}

async function resolveUser(admin: SupabaseClient, ev: RcEvent): Promise<string | null> {
  const candidates = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])]
    .filter((v): v is string => !!v && UUID_RE.test(v));
  for (const id of [...new Set(candidates)]) {
    const { data } = await admin.from("profiles").select("id").eq("id", id).maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

async function upsertSubscription(
  admin: SupabaseClient,
  userId: string,
  tier: Tier,
  fields: Record<string, unknown>,
  eventId: string,
  eventAt: string,
): Promise<{ id: string } | "stale" | "duplicate"> {
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id, last_event_id, last_event_at")
    .eq("user_id", userId)
    .eq("tier", tier)
    .maybeSingle();
  if (existing?.last_event_id === eventId) return "duplicate";
  if (existing?.last_event_at && new Date(existing.last_event_at) > new Date(eventAt)) return "stale";

  const row = {
    user_id: userId,
    tier,
    ...fields,
    last_event_id: eventId,
    last_event_at: eventAt,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id,tier" })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

/** TRANSFER: purchases moved between app users (e.g. restore on another account). */
async function handleTransfer(admin: SupabaseClient, ev: RcEvent, eventAt: string) {
  const from = (ev.transferred_from ?? []).filter((v) => UUID_RE.test(v));
  if (from.length) {
    await admin
      .from("subscriptions")
      .update({ status: "expired", will_renew: false, current_period_end: eventAt, last_event_id: ev.id, last_event_type: "TRANSFER", last_event_at: eventAt, updated_at: new Date().toISOString() })
      .in("user_id", from);
  }
  const apiKey = Deno.env.get("REVENUECAT_SECRET_API_KEY");
  const to = (ev.transferred_to ?? []).filter((v) => UUID_RE.test(v));
  if (!apiKey || !to.length) return { expired: from.length, synced: 0 };

  let synced = 0;
  for (const userId of to) {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) continue;
    const body = await res.json();
    const sub = body?.subscriber;
    const ents = (sub?.entitlements ?? {}) as Record<string, { expires_date: string | null; product_identifier: string }>;
    for (const [entId, ent] of Object.entries(ents)) {
      if (entId !== "match_plus" && entId !== "super_match") continue;
      const s = sub?.subscriptions?.[ent.product_identifier] ?? {};
      const expired = ent.expires_date && new Date(ent.expires_date) <= new Date();
      const status: Status = expired
        ? "expired"
        : s.billing_issues_detected_at
          ? "in_grace_period"
          : s.unsubscribe_detected_at
            ? "canceled"
            : "active";
      const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (!profile) continue;
      await upsertSubscription(admin, userId, entId as Tier, {
        status,
        store: mapStore(s.store),
        product_id: ent.product_identifier,
        environment: s.is_sandbox ? "SANDBOX" : "PRODUCTION",
        will_renew: !s.unsubscribe_detected_at,
        current_period_end: ent.expires_date,
        last_event_type: "TRANSFER",
      }, ev.id, eventAt);
      synced++;
    }
  }
  return { expired: from.length, synced };
}

/** Coin packs (consumables). Never touches subscriptions. */
async function handleCoins(admin: SupabaseClient, ev: RcEvent, userId: string) {
  const storeTx = ev.transaction_id || ev.original_transaction_id || `rc_event:${ev.id}`;
  if (ev.type === "NON_RENEWING_PURCHASE") {
    const { data, error } = await admin.rpc("credit_coin_purchase", {
      p_user: userId,
      p_product_id: ev.product_id,
      p_store_tx: storeTx,
      p_env: ev.environment ?? null,
    });
    if (error) throw error;
    if (typeof ev.price_in_purchased_currency === "number") {
      const { error: payErr } = await admin.from("payments").upsert(
        {
          user_id: userId,
          subscription_id: null,
          amount_cents: Math.round(ev.price_in_purchased_currency * 100),
          currency: (ev.currency ?? "EUR").toUpperCase(),
          store_transaction_id: storeTx,
          product_id: ev.product_id ?? null,
          environment: ev.environment ?? null,
          event_id: ev.id,
        },
        { onConflict: "store_transaction_id", ignoreDuplicates: true },
      );
      if (payErr) throw payErr;
    }
    return { ok: true, coins: data };
  }
  if (ev.type === "CANCELLATION") {
    const { data, error } = await admin.rpc("reverse_coin_purchase", { p_store_tx: storeTx });
    if (error) throw error;
    return { ok: true, reversal: data };
  }
  return { ok: true, ignored: `coins:${ev.type}` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!secret) return json({ error: "webhook_secret_not_configured" }, 503);
  if (!authorized(req, secret)) return json({ error: "unauthorized" }, 401);

  let ev: RcEvent;
  try {
    const body = await req.json();
    ev = body?.event;
    if (!ev?.id || !ev?.type) throw new Error("missing event");
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const eventAt = iso(ev.event_timestamp_ms) ?? new Date().toISOString();

  try {
    if (ev.type === "TEST") return json({ ok: true, test: true });
    if (ev.type === "TRANSFER") return json({ ok: true, ...(await handleTransfer(admin, ev, eventAt)) });

    const userId = await resolveUser(admin, ev);
    // Anonymous RevenueCat ids ($RCAnonymousID:…) or deleted users: acknowledge
    // so RevenueCat does not retry forever.
    if (!userId) return json({ ok: true, ignored: "unknown_app_user" });

    if (ev.product_id) {
      const { data: pack } = await admin
        .from("coin_packs")
        .select("product_id")
        .eq("product_id", ev.product_id)
        .maybeSingle();
      if (pack) return json(await handleCoins(admin, ev, userId));
    }

    let status: Status | null = null;
    let willRenew: boolean | null = null;
    switch (ev.type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "UNCANCELLATION":
      case "SUBSCRIPTION_EXTENDED":
      case "TEMPORARY_ENTITLEMENT_GRANT":
        status = "active";
        willRenew = true;
        break;
      case "NON_RENEWING_PURCHASE":
        status = "active";
        willRenew = false;
        break;
      case "CANCELLATION":
        // Access continues until expiration_at_ms (refunds set it to ~now).
        status = "canceled";
        willRenew = false;
        break;
      case "BILLING_ISSUE":
        status = "in_grace_period";
        break;
      case "EXPIRATION":
        status = "expired";
        willRenew = false;
        break;
      case "PRODUCT_CHANGE":
      case "SUBSCRIPTION_PAUSED":
      default:
        // Informational: the actual switch arrives as RENEWAL / INITIAL_PURCHASE.
        return json({ ok: true, ignored: ev.type });
    }

    const tier = tierFor(ev.entitlement_ids ?? (ev.entitlement_id ? [ev.entitlement_id] : null), ev.product_id);
    const fields: Record<string, unknown> = {
      status,
      store: mapStore(ev.store),
      product_id: ev.product_id ?? null,
      environment: ev.environment ?? null,
      original_transaction_id: ev.original_transaction_id ?? null,
      current_period_end: iso(ev.expiration_at_ms),
      last_event_type: ev.type,
    };
    if (willRenew !== null) fields.will_renew = willRenew;

    const sub = await upsertSubscription(admin, userId, tier, fields, ev.id, eventAt);
    if (sub === "duplicate" || sub === "stale") return json({ ok: true, skipped: sub });

    const isCharge = ["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE"].includes(ev.type);
    if (isCharge && ev.transaction_id && typeof ev.price_in_purchased_currency === "number" && ev.period_type !== "TRIAL") {
      const { error } = await admin.from("payments").upsert(
        {
          user_id: userId,
          subscription_id: sub.id,
          amount_cents: Math.round(ev.price_in_purchased_currency * 100),
          currency: (ev.currency ?? "EUR").toUpperCase(),
          store_transaction_id: ev.transaction_id,
          product_id: ev.product_id ?? null,
          environment: ev.environment ?? null,
          event_id: ev.id,
        },
        { onConflict: "store_transaction_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    }

    return json({ ok: true, user_id: userId, tier, status });
  } catch (e) {
    console.error("revenuecat-webhook error", ev.type, ev.id, e);
    // 500 → RevenueCat retries with backoff.
    return json({ error: "internal_error" }, 500);
  }
});
