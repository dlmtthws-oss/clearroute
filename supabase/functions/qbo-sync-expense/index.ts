import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncExpenseRequest {
  expenseId: string;
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

    const { data: syncSettings } = await supabase
      .from("quickbooks_sync_settings")
      .select("expense_account_mappings")
      .eq("user_id", userId)
      .single();

    const defaultMappings: Record<string, { id: string; name: string }> = {
      "fuel": { id: "", name: "Vehicle" },
      "equipment": { id: "", name: "Equipment" },
      "supplies": { id: "", name: "Supplies & Materials" },
      "insurance": { id: "", name: "Insurance" },
      "other": { id: "", name: "Other Business Expenses" },
    };

    const mappings = syncSettings?.expense_account_mappings || defaultMappings;
    const category = (expense.category || "other").toLowerCase();
    const accountMapping = mappings[category] || defaultMappings.other;

    const defaultAccount = { name: accountMapping.name, value: accountMapping.id || "1" };

    const qboBill: any = {
      VendorRef: {
        name: expense.supplier || "General Expense",
      },
      TxnDate: expense.expense_date || new Date().toISOString().split("T")[0],
      DueDate: expense.expense_date || new Date().toISOString().split("T")[0],
      Line: [
        {
          Description: expense.description || `Expense - ${category}`,
          Amount: Number(expense.amount) || 0,
          DetailType: "ItemBasedExpenseLineDetail",
          ItemBasedExpenseLineDetail: {
            ItemRef: defaultAccount,
            Qty: 1,
            UnitPrice: Number(expense.amount) || 0,
            TaxCodeRef: { value: expense.vat_reclaimable ? "2" : "0" },
          },
        },
      ],
    };

    if (expense.vat_reclaimable && expense.vat_amount) {
      qboBill.Line.push({
        Description: "VAT Reclaim",
        Amount: Number(expense.vat_amount) || 0,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: {
          ItemRef: { name: "VAT Input", value: "2" },
          Qty: 1,
          UnitPrice: Number(expense.vat_amount) || 0,
          TaxCodeRef: { value: "2" },
        },
      });
    }

    const method = expense.qbo_bill_id ? "POST" : "POST";
    const endpoint = expense.qbo_bill_id 
      ? `${baseUrl}/v3/company/${connection.realm_id}/purchase?minorversion=65&Id=${expense.qbo_bill_id}`
      : `${baseUrl}/v3/company/${connection.realm_id}/purchase?minorversion=65&type=Bill`;

    const apiResponse = await fetch(endpoint, {
      method: method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(qboBill),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("QuickBooks API error:", errorText);
      
      await supabase.from("quickbooks_sync_log").insert({
        user_id: userId,
        entity_type: "expense",
        entity_id: expenseId,
        direction: "to_qbo",
        status: "error",
        error_message: errorText,
      });

      return new Response(
        JSON.stringify({ error: "Failed to sync expense to QuickBooks", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdBill = responseData.Purchase || responseData.Bill;
    
    if (!createdBill?.Id) {
      return new Response(
        JSON.stringify({ error: "Invalid response from QuickBooks" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const syncedAt = new Date().toISOString();

    await supabase.from("expenses")
      .update({
        qbo_bill_id: createdBill.Id,
        qbo_synced_at: syncedAt,
      })
      .eq("id", expenseId);

    await supabase.from("quickbooks_sync_log").insert({
      user_id: userId,
      entity_type: "expense",
      entity_id: expenseId,
      direction: "to_qbo",
      status: "success",
      qbo_id: createdBill.Id,
    });

    return new Response(JSON.stringify({
      success: true,
      qbo_bill_id: createdBill.Id,
      synced_at: syncedAt,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing expense to QuickBooks:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});