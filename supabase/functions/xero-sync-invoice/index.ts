import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncInvoiceRequest {
  invoiceId: string;
  userId: string;
}

interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type: "ACCREC";
  Contact: { ContactID: string };
  Date: string;
  DueDate: string;
  Status: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID";
  LineItems: XeroLineItem[];
  Reference?: string;
  CurrencyCode?: string;
  DefaultTaxType?: string;
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
        JSON.stringify({ error: "Only sent or paid invoices can be synced to Xero" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invoice.customers?.xero_contact_id) {
      return new Response(
        JSON.stringify({ error: "Customer must be synced to Xero first" }),
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

    const xeroLineItems: XeroLineItem[] = (lineItems || []).map((item: any) => ({
      Description: item.description,
      Quantity: Number(item.quantity) || 1,
      UnitAmount: Number(item.unit_price) || 0,
      AccountCode: "200",
      TaxType: item.vat_rate > 0 ? "OUTPUT2" : "NONE",
      LineAmount: item.quantity && item.unit_price ? Number(item.quantity) * Number(item.unit_price) : undefined,
    }));

    if (xeroLineItems.length === 0) {
      xeroLineItems.push({
        Description: "Window Cleaning Service",
        Quantity: 1,
        UnitAmount: Number(invoice.total) || 0,
        AccountCode: "200",
        TaxType: "OUTPUT2",
      });
    }

    let xeroStatus: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" = "DRAFT";
    if (invoice.status === "sent") {
      xeroStatus = "SUBMITTED";
    } else if (invoice.status === "paid") {
      xeroStatus = "AUTHORISED";
    }

    const xeroInvoice: XeroInvoice = {
      InvoiceID: invoice.xero_invoice_id || undefined,
      InvoiceNumber: invoice.invoice_number,
      Type: "ACCREC",
      Contact: { ContactID: invoice.customers.xero_contact_id },
      Date: invoice.issue_date ? new Date(invoice.issue_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      DueDate: invoice.due_date ? new Date(invoice.due_date).toISOString().split("T")[0] : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      Status: xeroStatus,
      LineItems: xeroLineItems,
      Reference: invoice.invoice_number,
      CurrencyCode: "GBP",
    };

    const method = invoice.xero_invoice_id ? "PUT" : "POST";
    const endpoint = invoice.xero_invoice_id 
      ? `${XERO_API_URL}/Invoices/${invoice.xero_invoice_id}`
      : `${XERO_API_URL}/Invoices`;

    const apiResponse = await fetch(endpoint, {
      method: method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": connection.tenant_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Invoices: [xeroInvoice] }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Xero API error:", errorText);
      
      await supabase.from("xero_sync_log").insert({
        user_id: userId,
        entity_type: "invoice",
        entity_id: invoiceId,
        direction: "to_xero",
        status: "error",
        error_message: errorText,
      });

      await supabase.from("invoices")
        .update({
          xero_sync_status: "error",
          xero_sync_error: errorText,
        })
        .eq("id", invoiceId);

      return new Response(
        JSON.stringify({ error: "Failed to sync invoice to Xero", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdInvoice = responseData?.Invoices?.[0];
    
    if (!createdInvoice?.InvoiceID) {
      return new Response(
        JSON.stringify({ error: "Invalid response from Xero" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const syncedAt = new Date().toISOString();

    await supabase.from("invoices")
      .update({
        xero_invoice_id: createdInvoice.InvoiceID,
        xero_synced_at: syncedAt,
        xero_sync_status: "synced",
        xero_sync_error: null,
      })
      .eq("id", invoiceId);

    await supabase.from("xero_sync_log").insert({
      user_id: userId,
      entity_type: "invoice",
      entity_id: invoiceId,
      direction: "to_xero",
      status: "success",
      xero_id: createdInvoice.InvoiceID,
    });

    return new Response(JSON.stringify({
      success: true,
      xero_invoice_id: createdInvoice.InvoiceID,
      synced_at: syncedAt,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing invoice to Xero:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});