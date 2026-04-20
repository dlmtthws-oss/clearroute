import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthCallbackRequest {
  code: string;
  realmId: string;
  state: string;
}

interface IntuitTokenResponse {
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
    const clientId = Deno.env.get("QBO_CLIENT_ID");
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
    const redirectUri = Deno.env.get("QBO_REDIRECT_URI");
    const environment = Deno.env.get("QBO_ENVIRONMENT") || "sandbox";

    if (!clientId || !clientSecret || !redirectUri) {
      return new Response(
        JSON.stringify({ error: "QuickBooks not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { code, realmId, state } = await req.json() as AuthCallbackRequest;
    if (!code || !realmId) {
      return new Response(
        JSON.stringify({ error: "Code and realm ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    let userId: string;
    try {
      const decoded = JSON.parse(atob(state));
      userId = decoded.userId;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid state parameter" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID not found in state" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    const tokenUrlParams = new URLSearchParams();
    tokenUrlParams.set("grant_type", "authorization_code");
    tokenUrlParams.set("code", code);
    tokenUrlParams.set("redirect_uri", redirectUri);
    tokenUrlParams.set("client_id", clientId);
    tokenUrlParams.set("client_secret", clientSecret);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
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

    const tokenData: IntuitTokenResponse = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const baseUrl = environment === "sandbox" 
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    const companyResponse = await fetch(`${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`, {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Accept": "application/json",
      },
    });

    let companyName = "QuickBooks Company";
    if (companyResponse.ok) {
      const companyData = await companyResponse.json();
      companyName = companyData.CompanyInfo?.CompanyName || "QuickBooks Company";
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error: upsertError } = await supabase.from("quickbooks_connections").upsert({
      user_id: userId,
      realm_id: realmId,
      company_name: companyName,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      is_active: true,
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (upsertError) {
      console.error("Failed to store QuickBooks connection:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to store connection" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("quickbooks_sync_settings").upsert({
      user_id: userId,
      auto_sync_invoices: true,
      auto_sync_expenses: true,
      auto_sync_payments: true,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({
      success: true,
      organisation: {
        id: realmId,
        name: companyName,
      },
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in QuickBooks auth callback:", error);
    return new Response(
      JSON.stringify({ error: "Authentication failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});