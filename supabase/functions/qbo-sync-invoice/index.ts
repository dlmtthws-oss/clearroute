import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncInvoiceRequest {
  invoiceId: string;
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

    const { invoiceId, userId } = await req.json() as SyncInvoiceRequest;
    if (!invoiceId || !userId) {
      return new Response(
        JSON.stringify({ error: "Invoice ID and User ID required" }),
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

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*, customers:customers(*)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invoice.status !== "sent" && invoice.status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Only sent or paid invoices can be synced to QuickBooks" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invoice.customers?.qbo_customer_id) {
      return new Response(
        JSON.stringify({ error: "Customer must be synced to QuickBooks first" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: lineItems, error: lineItemsError } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoices_id", invoiceId)
      .order("created_at", { ascending: true });

    if (lineItemsError) {
      console.error("Failed to fetch line items:", lineItemsError);
    }

    const totalVat = Number(invoice.vat_amount) || 0;
    const subtotal = Number(invoice.subtotal) || 0;

    const qboLineItems: any[] = (lineItems || []).map((item, index) => ({
      Description: item.description,
      Amount: Number(item.unit_price) * Number(item.quantity),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { name: "Services", value: "1" },
        Qty: Number(item.quantity) || 1,
        UnitPrice: Number(item.unit_price) || 0,
        TaxCodeRef: { value: item.vat_rate > 0 ? "20" : "0" },
      },
    }));

    if (qboLineItems.length === 0) {
      qboLineItems.push({
        Description: "Window Cleaning Service",
        Amount: subtotal || Number(invoice.total) || 0,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { name: "Services", value: "1" },
          Qty: 1,
          UnitPrice: subtotal || Number(invoice.total) || 0,
          TaxCodeRef: { value: "20" },
        },
      });
    }

    if (totalVat > 0) {
      qboLineItems.push({
        Description: "VAT",
        Amount: totalVat,
        DetailType: "TaxLineDetail",
        TaxLineDetail: {
          TaxPercent: 20,
          TaxAmount: totalVat,
          TaxRateRef: { value: "20" },
        },
      });
    }

    const qboInvoice: any = {
      CustomerRef: { value: invoice.customers.qbo_customer_id },
      DocNumber: invoice.invoice_number,
      TxnDate: invoice.issue_date || new Date().toISOString().split("T")[0],
      DueDate: invoice.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      Line: qboLineItems,
    };

    if (invoice.status === "paid") {
      qboInvoice.Balance = 0;
    }

    const method = invoice.qbo_invoice_id ? "POST" : "POST";
    const endpoint = invoice.qbo_invoice_id 
      ? `${baseUrl}/v3/company/${connection.realm_id}/invoice?minorversion=65&Id=${invoice.qbo_invoice_id}`
      : `${baseUrl}/v3/company/${connection.realm_id}/invoice?minorversion=65`;

    const apiResponse = await fetch(endpoint, {
      method: method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(qboInvoice),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("QuickBooks API error:", errorText);
      
      await supabase.from("quickbooks_sync_log").insert({
        user_id: userId,
        entity_type: "invoice",
        entity_id: invoiceId,
        direction: "to_qbo",
        status: "error",
        error_message: errorText,
      });

      await supabase.from("invoices")
        .update({
          qbo_sync_status: "error",
          qbo_sync_error: errorText,
        })
        .eq("id", invoiceId);

      return new Response(
        JSON.stringify({ error: "Failed to sync invoice to QuickBooks", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdInvoice = responseData.Invoice;
    
    if (!createdInvoice?.Id) {
      return new Response(
        JSON.stringify({ error: "Invalid response from QuickBooks" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const syncedAt = new Date().toISOString();

    await supabase.from("invoices")
      .update({
        qbo_invoice_id: createdInvoice.Id,
        qbo_synced_at: syncedAt,
        qbo_sync_status: "synced",
        qbo_sync_error: null,
      })
      .eq("id", invoiceId);

    await supabase.from("quickbooks_sync_log").insert({
      user_id: userId,
      entity_type: "invoice",
      entity_id: invoiceId,
      direction: "to_qbo",
      status: "success",
      qbo_id: createdInvoice.Id,
    });

    return new Response(JSON.stringify({
      success: true,
      qbo_invoice_id: createdInvoice.Id,
      synced_at: syncedAt,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing invoice to QuickBooks:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});