import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FullSyncRequest {
  userId: string;
  entityType?: "all" | "customers" | "invoices" | "expenses" | "payments";
}

interface SyncResult {
  success: boolean;
  entityType: string;
  entityId: string;
  qboId?: string;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const { userId, entityType = "all" } = await req.json() as FullSyncRequest;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: connection } = await supabase
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "No active QuickBooks connection" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: SyncResult[] = [];
    let synced = 0;
    let errors = 0;
    let skipped = 0;

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    if (entityType === "all" || entityType === "customers") {
      const { data: unsyncedCustomers } = await supabase
        .from("customers")
        .select("id, name, qbo_customer_id")
        .eq("profiles_id", userId)
        .or("qbo_customer_id.is.null", "qbo_synced_at.is.null");

      for (const customer of unsyncedCustomers || []) {
        try {
          const syncResponse = await fetch(`${supabaseUrl}/functions/v1/qbo-sync-customer`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ customerId: customer.id, userId }),
          });

          const data = await syncResponse.json();
          
          if (syncResponse.ok && data.success) {
            results.push({ success: true, entityType: "customer", entityId: customer.id, qboId: data.qbo_customer_id });
            synced++;
          } else {
            results.push({ success: false, entityType: "customer", entityId: customer.id, error: data.error });
            errors++;
          }
        } catch (e: any) {
          results.push({ success: false, entityType: "customer", entityId: customer.id, error: e.message });
          errors++;
        }

        await delay(1000);
      }
    }

    if (entityType === "all" || entityType === "invoices") {
      const { data: unsyncedInvoices } = await supabase
        .from("invoices")
        .select("id, invoice_number, status, qbo_invoice_id, qbo_sync_status, customers:customers(qbo_customer_id)")
        .eq("profiles_id", userId)
        .in("status", ["sent", "paid"])
        .or("qbo_sync_status.not_synced", "qbo_sync_status.error");

      for (const invoice of unsyncedInvoices || []) {
        if (!invoice.customers?.qbo_customer_id) {
          skipped++;
          continue;
        }

        try {
          const syncResponse = await fetch(`${supabaseUrl}/functions/v1/qbo-sync-invoice`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ invoiceId: invoice.id, userId }),
          });

          const data = await syncResponse.json();
          
          if (syncResponse.ok && data.success) {
            results.push({ success: true, entityType: "invoice", entityId: invoice.id, qboId: data.qbo_invoice_id });
            synced++;
          } else {
            results.push({ success: false, entityType: "invoice", entityId: invoice.id, error: data.error });
            errors++;
          }
        } catch (e: any) {
          results.push({ success: false, entityType: "invoice", entityId: invoice.id, error: e.message });
          errors++;
        }

        await delay(1000);
      }
    }

    if (entityType === "all" || entityType === "payments") {
      const { data: unsyncedPayments } = await supabase
        .from("payments")
        .select("id, invoices:invoices(qbo_invoice_id)")
        .eq("profiles_id", userId)
        .is("qbo_payment_id", null);

      for (const payment of unsyncedPayments || []) {
        if (!payment.invoices?.qbo_invoice_id) {
          skipped++;
          continue;
        }

        try {
          const syncResponse = await fetch(`${supabaseUrl}/functions/v1/qbo-sync-payment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ paymentId: payment.id, userId }),
          });

          const data = await syncResponse.json();
          
          if (syncResponse.ok && data.success) {
            results.push({ success: true, entityType: "payment", entityId: payment.id, qboId: data.qbo_payment_id });
            synced++;
          } else {
            results.push({ success: false, entityType: "payment", entityId: payment.id, error: data.error });
            errors++;
          }
        } catch (e: any) {
          results.push({ success: false, entityType: "payment", entityId: payment.id, error: e.message });
          errors++;
        }

        await delay(1000);
      }
    }

    if (entityType === "all" || entityType === "expenses") {
      const { data: unsyncedExpenses } = await supabase
        .from("expenses")
        .select("id, description, qbo_bill_id")
        .eq("profiles_id", userId)
        .or("qbo_bill_id.is.null", "qbo_synced_at.is.null");

      for (const expense of unsyncedExpenses || []) {
        try {
          const syncResponse = await fetch(`${supabaseUrl}/functions/v1/qbo-sync-expense`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ expenseId: expense.id, userId }),
          });

          const data = await syncResponse.json();
          
          if (syncResponse.ok && data.success) {
            results.push({ success: true, entityType: "expense", entityId: expense.id, qboId: data.qbo_bill_id });
            synced++;
          } else {
            results.push({ success: false, entityType: "expense", entityId: expense.id, error: data.error });
            errors++;
          }
        } catch (e: any) {
          results.push({ success: false, entityType: "expense", entityId: expense.id, error: e.message });
          errors++;
        }

        await delay(1000);
      }
    }

    await supabase.from("quickbooks_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", userId);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        synced,
        errors,
        skipped,
        total: synced + errors + skipped,
      },
      results: results.slice(-50),
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in full sync:", error);
    return new Response(
      JSON.stringify({ error: "Full sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});