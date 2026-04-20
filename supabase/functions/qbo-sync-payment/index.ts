import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncPaymentRequest {
  paymentId: string;
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

    const { paymentId, userId } = await req.json() as SyncPaymentRequest;
    if (!paymentId || !userId) {
      return new Response(
        JSON.stringify({ error: "Payment ID and User ID required" }),
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

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*, invoices:invoices(*)")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!payment.invoices?.qbo_invoice_id) {
      return new Response(
        JSON.stringify({ error: "Invoice must be synced to QuickBooks first" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: syncSettings } = await supabase
      .from("quickbooks_sync_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    const defaultBankAccount = { name: "Checking", value: "1" };
    const bankAccount = syncSettings?.bank_account_id 
      ? { name: syncSettings.bank_account_name, value: syncSettings.bank_account_id }
      : defaultBankAccount;

    const qboPayment: any = {
      CustomerRef: { value: payment.invoices?.customers?.qbo_customer_id || "" },
      TotalAmt: Number(payment.amount),
      TxnDate: payment.payment_date || new Date().toISOString().split("T")[0],
      Line: [
        {
          Amount: Number(payment.amount),
          LinkedTxn: [{ TxnId: payment.invoices.qbo_invoice_id, TxnType: "Invoice" }],
          DepositToAccountRef: bankAccount,
        },
      ],
    };

    const apiResponse = await fetch(`${baseUrl}/v3/company/${connection.realm_id}/payment?minorversion=65`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(qboPayment),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("QuickBooks API error:", errorText);
      
      await supabase.from("quickbooks_sync_log").insert({
        user_id: userId,
        entity_type: "payment",
        entity_id: paymentId,
        direction: "to_qbo",
        status: "error",
        error_message: errorText,
      });

      return new Response(
        JSON.stringify({ error: "Failed to sync payment to QuickBooks", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdPayment = responseData.Payment;
    
    if (!createdPayment?.Id) {
      return new Response(
        JSON.stringify({ error: "Invalid response from QuickBooks" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("payments")
      .update({
        qbo_payment_id: createdPayment.Id,
      })
      .eq("id", paymentId);

    await supabase.from("invoices")
      .update({
        status: "paid",
      })
      .eq("id", payment.invoices_id);

    await supabase.from("quickbooks_sync_log").insert({
      user_id: userId,
      entity_type: "payment",
      entity_id: paymentId,
      direction: "to_qbo",
      status: "success",
      qbo_id: createdPayment.Id,
    });

    return new Response(JSON.stringify({
      success: true,
      qbo_payment_id: createdPayment.Id,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing payment to QuickBooks:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});