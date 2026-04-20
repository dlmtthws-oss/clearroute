import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_ORGANISATIONS_URL = "https://api.xero.com/api.xro/2.0/Organisation";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthCallbackRequest {
  code: string;
  userId: string;
}

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface XeroOrganisation {
  TenantId: string;
  TenantName: string;
  TenantType: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    const redirectUri = Deno.env.get("XERO_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      return new Response(
        JSON.stringify({ error: "Xero not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { code, userId } = await req.json() as AuthCallbackRequest;
    if (!code || !userId) {
      return new Response(
        JSON.stringify({ error: "Code and user ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenUrlParams = new URLSearchParams();
    tokenUrlParams.set("grant_type", "authorization_code");
    tokenUrlParams.set("code", code);
    tokenUrlParams.set("redirect_uri", redirectUri);
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
      console.error("Token exchange failed:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to exchange code for tokens" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData: XeroTokenResponse = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const connectionsResponse = await fetch("https://api.xero.com/connections", {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!connectionsResponse.ok) {
      console.error("Failed to get Xero connections");
      return new Response(
        JSON.stringify({ error: "Failed to get organisation list" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const connections: XeroOrganisation[] = await connectionsResponse.json();

    if (connections.length === 0) {
      return new Response(
        JSON.stringify({ error: "No Xero organisations found" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const activeConnection = connections[0];

    const { error: upsertError } = await supabase.from("xero_connections").upsert({
      user_id: userId,
      tenant_id: activeConnection.TenantId,
      tenant_name: activeConnection.TenantName,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      is_active: true,
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (upsertError) {
      console.error("Failed to store Xero connection:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to store connection" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("xero_sync_settings").upsert({
      user_id: userId,
      auto_sync_invoices: true,
      auto_sync_expenses: true,
      auto_sync_payments: true,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({
      success: true,
      organisation: {
        id: activeConnection.TenantId,
        name: activeConnection.TenantName,
      },
      allOrganisations: connections.map(c => ({
        id: c.TenantId,
        name: c.TenantName,
      })),
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in Xero auth callback:", error);
    return new Response(
      JSON.stringify({ error: "Authentication failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});