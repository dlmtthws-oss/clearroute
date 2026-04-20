import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefreshTokenRequest {
  userId: string;
  forceRefresh?: boolean;
}

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "Xero not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId, forceRefresh = false } = await req.json() as RefreshTokenRequest;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: connection, error: fetchError } = await supabase
      .from("xero_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (fetchError || !connection) {
      return new Response(
        JSON.stringify({ error: "No active Xero connection found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenExpiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (!forceRefresh && tokenExpiresAt > fiveMinutesFromNow) {
      return new Response(JSON.stringify({
        success: true,
        message: "Token still valid",
        expires_at: connection.token_expires_at,
      }), {
        headers: { ...CORSHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenUrlParams = new URLSearchParams();
    tokenUrlParams.set("grant_type", "refresh_token");
    tokenUrlParams.set("refresh_token", connection.refresh_token);
    tokenUrlParams.set("client_id", clientId);
    tokenUrlParams.set("client_secret", clientSecret);

    const tokenResponse = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenUrlParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token refresh failed:", errorText);
      
      if (errorText.includes("invalid_grant") || errorText.includes("expired")) {
        await supabase.from("xero_connections")
          .update({ is_active: false })
          .eq("user_id", userId);
          
        return new Response(
          JSON.stringify({ error: "Refresh token expired. Please re-authenticate.", code: "REAUTH_REQUIRED" }),
          { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to refresh token" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData: XeroTokenResponse = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: updateError } = await supabase.from("xero_connections")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to update tokens:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to store new tokens" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({
      success: true,
      expires_at: expiresAt,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error refreshing Xero token:", error);
    return new Response(
      JSON.stringify({ error: "Token refresh failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});