import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncPaymentRequest {
  paymentId: string;
  userId: string;
}

interface XeroPayment {
  Invoice: { InvoiceID: string };
  Account: { AccountCode: string };
  Date: string;
  Amount: number;
  Reference?: string;
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

    if (!payment.invoices?.xero_invoice_id) {
      return new Response(
        JSON.stringify({ error: "Invoice must be synced to Xero first" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountCodeMap: Record<string, string> = {
      "cash": "090",
      "bank": "090",
      "card": "200",
      "direct_debit": "090",
      "standing_order": "090",
      "cheque": "090",
      "bacs": "090",
      "other": "090",
    };

    const methodKey = (payment.payment_method || "other").toLowerCase();
    const accountCode = accountCodeMap[methodKey] || "090";

    const xeroPayment: XeroPayment = {
      Invoice: { InvoiceID: payment.invoices.xero_invoice_id },
      Account: { AccountCode: accountCode },
      Date: payment.payment_date ? new Date(payment.payment_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      Amount: Number(payment.amount),
      Reference: `Payment for ${payment.invoices.invoice_number}`,
    };

    const apiResponse = await fetch(`${XERO_API_URL}/Payments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": connection.tenant_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Payments: [xeroPayment] }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Xero API error:", errorText);
      
      await supabase.from("xero_sync_log").insert({
        user_id: userId,
        entity_type: "payment",
        entity_id: paymentId,
        direction: "to_xero",
        status: "error",
        error_message: errorText,
      });

      return new Response(
        JSON.stringify({ error: "Failed to sync payment to Xero", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdPayment = responseData?.Payments?.[0];
    
    if (!createdPayment?.PaymentID) {
      return new Response(
        JSON.stringify({ error: "Invalid response from Xero" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("payments")
      .update({
        xero_payment_id: createdPayment.PaymentID,
      })
      .eq("id", paymentId);

    await supabase.from("invoices")
      .update({
        status: "paid",
      })
      .eq("id", payment.invoices_id);

    await supabase.from("xero_sync_log").insert({
      user_id: userId,
      entity_type: "payment",
      entity_id: paymentId,
      direction: "to_xero",
      status: "success",
      xero_id: createdPayment.PaymentID,
    });

    return new Response(JSON.stringify({
      success: true,
      xero_payment_id: createdPayment.PaymentID,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing payment to Xero:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});