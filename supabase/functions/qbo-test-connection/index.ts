import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

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

    const environment = Deno.env.get("QBO_ENVIRONMENT") || "sandbox";
    const baseUrl = environment === "sandbox" 
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: connection, error } = await supabase
      .from("quickbooks_connections")
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
      const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/qbo-refresh-token`, {
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
        .from("quickbooks_connections")
        .select("access_token")
        .eq("user_id", userId)
        .single();
      
      if (refreshed) {
        accessToken = refreshed.access_token;
      }
    }

    const apiResponse = await fetch(`${baseUrl}/v3/company/${connection.realm_id}/companyinfo/${connection.realm_id}?minorversion=65`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
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
    const companyInfo = data.CompanyInfo;

    return new Response(JSON.stringify({
      connected: true,
      organisation: companyInfo ? {
        name: companyInfo.CompanyName,
        id: connection.realm_id,
      } : null,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error testing QuickBooks connection:", error);
    return new Response(
      JSON.stringify({ connected: false, error: "Connection test failed" }),
      { status: 200, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});
