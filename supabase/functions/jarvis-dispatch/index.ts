import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// jarvis-dispatch: executes a registered automation by calling its n8n webhook.
//
// Flow: Jarvis (in ai-assistant) proposes an action -> the user confirms in the
// HUD -> the browser calls this function -> we verify the caller, look up the
// automation, sign the payload, and POST it to the self-hosted n8n webhook.
//
// Required Supabase secrets:
//   N8N_WEBHOOK_BASE_URL   e.g. https://n8n.yourdomain.com  (your self-hosted n8n)
//   N8N_WEBHOOK_SECRET     shared secret; n8n verifies the HMAC signature
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided by the platform)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DispatchRequest {
  automationId: string;
  params?: Record<string, unknown>;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Verify the caller from their JWT (do NOT trust a user id in the body).
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { automationId, params = {} } = (await req.json()) as DispatchRequest;
    if (!automationId) {
      return new Response(JSON.stringify({ error: "automationId required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 2. Load the automation and confirm it belongs to the caller and is on.
    const { data: automation } = await admin
      .from("jarvis_automations")
      .select("*")
      .eq("id", automationId)
      .eq("user_id", user.id)
      .eq("enabled", true)
      .single();

    if (!automation) {
      return new Response(JSON.stringify({ error: "Automation not found or disabled" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const baseUrl = Deno.env.get("N8N_WEBHOOK_BASE_URL");
    const secret = Deno.env.get("N8N_WEBHOOK_SECRET");
    if (!baseUrl || !secret) {
      return new Response(
        JSON.stringify({ error: "n8n is not configured. Set N8N_WEBHOOK_BASE_URL and N8N_WEBHOOK_SECRET." }),
        { status: 503, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // 3. Record the run (pre-execution) so it's auditable / visible cross-device.
    const { data: run } = await admin
      .from("jarvis_action_runs")
      .insert({
        user_id: user.id,
        automation_id: automation.id,
        automation_name: automation.name,
        params,
        status: "running",
      })
      .select()
      .single();

    // 4. Build the signed request to the self-hosted n8n webhook.
    const url = baseUrl.replace(/\/$/, "") + "/" + automation.webhook_path.replace(/^\//, "");
    const timestamp = Date.now().toString();
    const bodyObj = {
      automation: automation.name,
      params,
      user_id: user.id,
      run_id: run?.id,
      requested_at: new Date().toISOString(),
    };
    const body = JSON.stringify(bodyObj);
    const signature = await hmacHex(secret, timestamp + "." + body);

    let result: unknown = null;
    let ok = false;
    let errorText: string | null = null;

    try {
      const method = automation.http_method || "POST";
      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-jarvis-timestamp": timestamp,
          "x-jarvis-signature": signature,
        },
        body: method === "GET" ? undefined : body,
      });
      const text = await resp.text();
      try { result = JSON.parse(text); } catch { result = text; }
      ok = resp.ok;
      if (!ok) errorText = `n8n returned ${resp.status}`;
    } catch (e) {
      errorText = (e as Error).message;
    }

    // 5. Finalize the run record.
    if (run?.id) {
      await admin.from("jarvis_action_runs").update({
        status: ok ? "success" : "error",
        result: result ?? null,
        error: errorText,
        duration_ms: Date.now() - startedAt,
      }).eq("id", run.id);
    }

    return new Response(
      JSON.stringify({ ok, runId: run?.id, result, error: errorText }),
      { status: ok ? 200 : 502, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
