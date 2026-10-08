import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * cleanup-story-media — removes story-media objects that outlived their story.
 *
 * Called hourly by pg_cron (job `cleanup-story-media`, via pg_net) with the
 * project's public anon JWT (stored in Vault as `match_cron_anon_key`).
 * verify_jwt = true at the gateway. The work is idempotent and can only delete
 * objects that are > 26h old AND referenced by no remaining public.stories row
 * (stories expire after 24h and are purged by the `purge-expired-stories` job),
 * so an extra call by anyone holding the public key is harmless.
 *
 * The service-role key is injected by the Edge runtime — it is never shipped
 * to clients and never stored in git.
 */

const BUCKET = "story-media";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", Connection: "keep-alive" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Missing Supabase runtime env" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let removed = 0;
  const errors: string[] = [];
  // At most 5 rounds of 500 per invocation; the next hourly run picks up the rest.
  for (let round = 0; round < 5; round++) {
    const { data, error } = await admin.rpc("story_media_garbage", { p_limit: 500 });
    if (error) return json({ error: error.message, removed }, 500);
    const names = ((data ?? []) as { name: string }[]).map((r) => r.name).filter(Boolean);
    if (!names.length) break;
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const { data: gone, error: rmError } = await admin.storage.from(BUCKET).remove(chunk);
      if (rmError) {
        errors.push(rmError.message);
        break;
      }
      removed += gone?.length ?? 0;
    }
    if (errors.length || names.length < 500) break;
  }

  return json({ ok: errors.length === 0, removed, errors });
});
