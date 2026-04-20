import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthStartRequest {
  userId: string;
}

function generateState(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const clientId = Deno.env.get("QBO_CLIENT_ID");
    const redirectUri = Deno.env.get("QBO_REDIRECT_URI");

    if (!clientId || !redirectUri) {
      return new Response(
        JSON.stringify({ error: "QuickBooks not configured. Please set QBO_CLIENT_ID and QBO_REDIRECT_URI environment variables." }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId } = await req.json() as AuthStartRequest;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const state = generateState();
    const encodedState = btoa(JSON.stringify({ state, userId }));

    const authUrl = new URL(INTUIT_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "com.intuit.quickbooks.accounting");
    authUrl.searchParams.set("state", encodedState);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("quickbooks_connections").upsert({
      user_id: userId,
      realm_id: "pending",
      company_name: "pending",
      access_token: "pending",
      refresh_token: "pending",
      token_expires_at: new Date().toISOString(),
      is_active: false,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({ authUrl: authUrl.toString(), state }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error generating QuickBooks auth URL:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate auth URL" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});