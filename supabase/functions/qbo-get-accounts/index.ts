import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GetAccountsRequest {
  userId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const environment = Deno.env.get("QBO_ENVIRONMENT") || "sandbox";
    const baseUrl = environment === "sandbox" 
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    const { userId } = await req.json() as GetAccountsRequest;
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
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (fetchError || !connection) {
      return new Response(
        JSON.stringify({ error: "No active QuickBooks connection" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
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
          JSON.stringify({ error: "Failed to refresh token" }),
          { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
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

    const apiResponse = await fetch(`${baseUrl}/v3/company/${connection.realm_id}/query?minorversion=65`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/text",
        "Accept": "application/json",
      },
      body: "SELECT Id, Name, AccountType, AccountSubType FROM Account WHERE Active = true",
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("QuickBooks API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch accounts", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const accounts = responseData.QueryResponse?.Account || [];

    const incomeAccounts = accounts.filter((a: any) => a.AccountType === "Income");
    const expenseAccounts = accounts.filter((a: any) => a.AccountType === "Expense" || a.AccountType === "Other Expense");
    const bankAccounts = accounts.filter((a: any) => a.AccountType === "Bank");

    return new Response(JSON.stringify({
      income: incomeAccounts.map((a: any) => ({ id: a.Id, name: a.Name })),
      expense: expenseAccounts.map((a: any) => ({ id: a.Id, name: a.Name, type: a.AccountSubType })),
      bank: bankAccounts.map((a: any) => ({ id: a.Id, name: a.Name })),
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch accounts" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});