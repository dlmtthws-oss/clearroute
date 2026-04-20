import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const TRUELAYER_BALANCE_URL = "https://api.truelayer.com/api/v1/balance";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BalanceRequest {
  connectionId: string;
}

async function refreshTokenIfNeeded(supabase, refreshToken: string): Promise<string | null> {
  const clientId = Deno.env.get("TRUELAYER_CLIENT_ID");
  const clientSecret = Deno.env.get("TRUELAYER_CLIENT_SECRET");

  if (!clientId || !clientSecret) return null;

  const formData = new URLSearchParams();
  formData.set("grant_type", "refresh_token");
  formData.set("client_id", clientId);
  formData.set("client_secret", clientSecret);
  formData.set("refresh_token", refreshToken);

  const response = await fetch("https://auth.truelayer.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { connectionId } = await req.json() as BalanceRequest;

    if (!connectionId) {
      return new Response(
        JSON.stringify({ error: "Connection ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: connection } = await supabase
      .from("bank_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "Connection not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    let accessToken = connection.access_token;
    const tokenExpires = new Date(connection.token_expires_at);
    if (tokenExpires <= new Date()) {
      accessToken = await refreshTokenIfNeeded(supabase, connection.refresh_token);
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Token expired. Please reconnect." }),
          { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );

        await supabase
          .from("bank_connections")
          .update({ is_active: false })
          .eq("id", connectionId);
      }

      await supabase
        .from("bank_connections")
        .update({ access_token: accessToken })
        .eq("id", connectionId);
    }

    const balanceUrl = new URL(TRUELAYER_BALANCE_URL);
    balanceUrl.searchParams.set("account_id", connection.truelayer_connection_id);

    const balanceResponse = await fetch(balanceUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!balanceResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch balance" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const balanceData = (await balanceResponse.json()) as {
      results: Array<{ available: number; current: number; currency: string; as_of: string }>;
    };

    const balance = balanceData.results?.[0];

    return new Response(
      JSON.stringify({
        available: balance?.available,
        current: balance?.current,
        currency: balance?.currency || "GBP",
        asOf: balance?.as_of,
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Balance error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to get balance" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});