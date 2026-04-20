import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncExpenseRequest {
  expenseId: string;
  userId: string;
}

interface XeroBill {
  Bill?: boolean;
  Type: "ACCPAY";
  Contact?: { Name: string };
  Date: string;
  DueDate: string;
  Reference?: string;
  LineItems: XeroLineItem[];
  CurrencyCode?: string;
}

interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  TaxType: string;
  LineAmount?: number;
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

    const { expenseId, userId } = await req.json() as SyncExpenseRequest;
    if (!expenseId || !userId) {
      return new Response(
        JSON.stringify({ error: "Expense ID and User ID required" }),
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
        JSON.stringify({ error: "No active Xero connection" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
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
          JSON.stringify({ error: "Failed to refresh token" }),
          { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
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

    const { data: expense, error: expenseError } = await supabase
      .from("expenses")
      .select("*")
      .eq("id", expenseId)
      .single();

    if (expenseError || !expense) {
      return new Response(
        JSON.stringify({ error: "Expense not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: settings } = await supabase
      .from("xero_sync_settings")
      .select("account_code_mappings")
      .eq("user_id", userId)
      .single();

    const defaultMappings: Record<string, string> = {
      "fuel": "449",
      "equipment": "720",
      "supplies": "400",
      "insurance": "478",
      "other": "404",
    };

    const mappings = settings?.account_code_mappings || defaultMappings;
    const category = (expense.category || "other").toLowerCase();
    const accountCode = mappings[category] || defaultMappings.other;

    const taxType = expense.vat_reclaimable ? "INPUT2" : "NONE";

    const xeroLineItem: XeroLineItem = {
      Description: expense.description || `Expense - ${category}`,
      Quantity: 1,
      UnitAmount: Number(expense.amount) || 0,
      AccountCode: accountCode,
      TaxType: taxType,
    };

    const xeroBill: XeroBill = {
      Bill: true,
      Type: "ACCPAY",
      Contact: { Name: expense.supplier || "General Expense" },
      Date: expense.expense_date ? new Date(expense.expense_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      DueDate: expense.expense_date ? new Date(expense.expense_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      Reference: expense.description || `Expense ${expenseId.slice(0, 8)}`,
      LineItems: [xeroLineItem],
      CurrencyCode: "GBP",
    };

    const method = expense.xero_bill_id ? "PUT" : "POST";
    const endpoint = expense.xero_bill_id 
      ? `${XERO_API_URL}/Invoices/${expense.xero_bill_id}`
      : `${XERO_API_URL}/Invoices`;

    const apiResponse = await fetch(endpoint, {
      method: method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": connection.tenant_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Invoices: [xeroBill] }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Xero API error:", errorText);
      
      await supabase.from("xero_sync_log").insert({
        user_id: userId,
        entity_type: "expense",
        entity_id: expenseId,
        direction: "to_xero",
        status: "error",
        error_message: errorText,
      });

      return new Response(
        JSON.stringify({ error: "Failed to sync expense to Xero", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdBill = responseData?.Invoices?.[0];
    
    if (!createdBill?.InvoiceID) {
      return new Response(
        JSON.stringify({ error: "Invalid response from Xero" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const syncedAt = new Date().toISOString();

    await supabase.from("expenses")
      .update({
        xero_bill_id: createdBill.InvoiceID,
        xero_synced_at: syncedAt,
      })
      .eq("id", expenseId);

    await supabase.from("xero_sync_log").insert({
      user_id: userId,
      entity_type: "expense",
      entity_id: expenseId,
      direction: "to_xero",
      status: "success",
      xero_id: createdBill.InvoiceID,
    });

    return new Response(JSON.stringify({
      success: true,
      xero_bill_id: createdBill.InvoiceID,
      synced_at: syncedAt,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing expense to Xero:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});