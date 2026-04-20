import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const TRUELAYER_TOKEN_URL = "https://auth.truelayer.com/connect/token";
const TRUELAYER_ACCOUNTS_URL = "https://api.truelayer.com/api/v1/accounts";
const TRUELAYER_PROVIDER_URL = "https://api.truelayer.com/api/v1/providers";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthCallbackRequest {
  code: string;
  state: string;
  userId: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface TrueLayerAccount {
  account_id: string;
  display_name: string;
  account_number?: {
    number: string;
    sort_code: string;
  };
  currency: string;
  provider: {
    provider_id: string;
    display_name: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { code, state, userId } = await req.json() as AuthCallbackRequest;

    if (!code || !state || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = Deno.env.get("TRUELAYER_CLIENT_ID");
    const clientSecret = Deno.env.get("TRUELAYER_CLIENT_SECRET");
    const redirectUri = Deno.env.get("TRUELAYER_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      return new Response(
        JSON.stringify({ error: "TrueLayer not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: storedState } = await supabase
      .from("bank_connection_tokens")
      .select("code_verifier")
      .eq("user_id", userId)
      .single();

    if (!storedState || storedState.auth_state !== state) {
      return new Response(
        JSON.stringify({ error: "Invalid state parameter" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenFormData = new URLSearchParams();
    tokenFormData.set("grant_type", "authorization_code");
    tokenFormData.set("client_id", clientId);
    tokenFormData.set("client_secret", clientSecret);
    tokenFormData.set("redirect_uri", redirectUri);
    tokenFormData.set("code", code);
    tokenFormData.set("code_verifier", storedState.code_verifier);

    const tokenResponse = await fetch(TRUELAYER_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenFormData.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", tokenResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to exchange code for token" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData = (await tokenResponse.json()) as TokenResponse;
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const accountsResponse = await fetch(TRUELAYER_ACCOUNTS_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!accountsResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch accounts" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountsData = (await accountsResponse.json()) as { results: TrueLayerAccount[] };
    const account = accountsData.results[0];

    if (!account) {
      return new Response(
        JSON.stringify({ error: "No account found" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const connection = {
      user_id: userId,
      bank_name: account.provider.display_name,
      account_name: account.display_name,
      account_number_last4: account.account_number?.number?.slice(-4),
      sort_code: account.account_number?.sort_code,
      currency: account.currency,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenExpiresAt,
      truelayer_connection_id: account.account_id,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    const { data: existingConnection } = await supabase
      .from("bank_connections")
      .select("id")
      .eq("truelayer_connection_id", account.account_id)
      .single();

    if (existingConnection) {
      await supabase
        .from("bank_connections")
        .update(connection)
        .eq("truelayer_connection_id", account.account_id);
    } else {
      await supabase.from("bank_connections").insert(connection);
    }

    await supabase
      .from("bank_connection_tokens")
      .delete()
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({
        success: true,
        accountName: account.display_name,
        bankName: account.provider.display_name,
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Auth callback error:", error);
    return new Response(
      JSON.stringify({ error: "Authentication failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});