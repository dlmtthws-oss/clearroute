import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: connection, error } = await supabase
      .from("xero_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (error || !connection) {
      return new Response(
        JSON.stringify({ connected: false, error: "No active connection" }),
        { status: 200, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenExpiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    let accessToken = connection.access_token;
    if (tokenExpiresAt <= fiveMinutesFromNow) {
      const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/xero-refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ userId }),
      });

      if (!refreshResponse.ok) {
        return new Response(
          JSON.stringify({ connected: false, error: "Token refresh failed - please reconnect" }),
          { status: 200, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: refreshed } = await supabase
        .from("xero_connections")
        .select("access_token")
        .eq("user_id", userId)
        .single();
      
      if (refreshed) {
        accessToken = refreshed.access_token;
      }
    }

    const apiResponse = await fetch(`${XERO_API_URL}/Organisation`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": connection.tenant_id,
        "Content-Type": "application/json",
      },
    });

    if (!apiResponse.ok) {
      return new Response(
        JSON.stringify({ connected: false, error: "API request failed - please reconnect" }),
        { status: 200, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await apiResponse.json();
    const organisation = data.Organisations?.[0];

    return new Response(JSON.stringify({
      connected: true,
      organisation: organisation ? {
        name: organisation.OrganisationName,
        id: organisation.OrganisationID,
      } : null,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error testing Xero connection:", error);
    return new Response(
      JSON.stringify({ connected: false, error: "Connection test failed" }),
      { status: 200, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});
