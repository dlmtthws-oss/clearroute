import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const XERO_WEBHOOK_KEY = Deno.env.get("XERO_WEBHOOK_KEY") || "";

function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!XERO_WEBHOOK_KEY) {
    console.warn("XERO_WEBHOOK_KEY not configured - skipping verification");
    return true;
  }

  const expectedSignature = createHmac("sha256", XERO_WEBHOOK_KEY)
    .update(payload)
    .digest("hex");

  return signature === expectedSignature;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const signature = req.headers.get("x-xero-signature") || "";
    const payload = await req.text();

    if (!verifyWebhookSignature(payload, signature)) {
      console.error("Invalid webhook signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const webhookData = JSON.parse(payload);
    const events = webhookData.events || [];

    if (events.length === 0) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...CORSHeaders, "Content-Type": "application/json" },
      };
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const processedEvents: any[] = [];

    for (const event of events) {
      const eventType = event.eventType || "";
      const resourceId = event.resourceId || "";
      const tenantId = event.tenantId || "";

      console.log(`Processing Xero webhook: ${eventType} for ${resourceId}`);

      if (eventType === "Invoice.UPDATED") {
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, xero_invoice_id, status")
          .eq("xero_invoice_id", resourceId)
          .limit(1);

        if (invoices && invoices.length > 0) {
          const invoice = invoices[0];
            
          await supabase.from("xero_sync_log").insert({
            user_id: invoice.profiles_id,
            entity_type: "invoice",
            entity_id: invoice.id,
            direction: "from_xero",
            status: "success",
            xero_id: resourceId,
          });

          processedEvents.push({ type: "invoice", id: invoice.id, status: "processed" });
        }
      } else if (eventType === "Contact.UPDATED") {
        const { data: customers } = await supabase
          .from("customers")
          .select("id, profiles_id, xero_contact_id")
          .eq("xero_contact_id", resourceId)
          .limit(1);

        if (customers && customers.length > 0) {
          const customer = customers[0];

          await supabase.from("xero_sync_log").insert({
            user_id: customer.profiles_id,
            entity_type: "customer",
            entity_id: customer.id,
            direction: "from_xero",
            status: "success",
            xero_id: resourceId,
          });

          processedEvents.push({ type: "contact", id: customer.id, status: "processed" });
        }
      } else if (eventType === "Invoice.PAID") {
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, status")
          .eq("xero_invoice_id", resourceId)
          .limit(1);

        if (invoices && invoices.length > 0 && invoices[0].status !== "paid") {
          await supabase.from("invoices")
            .update({ status: "paid" })
            .eq("xero_invoice_id", resourceId);

          processedEvents.push({ type: "invoice_paid", id: resourceId, status: "updated" });
        }
      }
    }

    return new Response(JSON.stringify({ 
      received: true, 
      processed: processedEvents.length,
      events: processedEvents,
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing Xero webhook:", error);
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});