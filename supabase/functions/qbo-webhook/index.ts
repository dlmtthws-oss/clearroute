import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const signature = req.headers.get("Intuit-Signature") || "";
    const payload = await req.text();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const webhookData = JSON.parse(payload);
    const events = webhookData.eventNotifications || [];

    if (events.length === 0) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...CORSHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const processedEvents: any[] = [];

    for (const notification of events) {
      for (const event of notification.events || []) {
        const eventType = event.name || "";
        const entityId = event.id || "";

        console.log(`Processing QuickBooks webhook: ${eventType} for ${entityId}`);

        if (eventType === "Invoice") {
          const { data: invoices } = await supabase
            .from("invoices")
            .select("id, status")
            .eq("qbo_invoice_id", entityId)
            .limit(1);

          if (invoices && invoices.length > 0) {
            processedEvents.push({ type: "invoice", id: entityId, status: "processed" });
          }
        } else if (eventType === "Customer") {
          const { data: customers } = await supabase
            .from("customers")
            .select("id")
            .eq("qbo_customer_id", entityId)
            .limit(1);

          if (customers && customers.length > 0) {
            processedEvents.push({ type: "customer", id: entityId, status: "processed" });
          }
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
    console.error("Error processing QuickBooks webhook:", error);
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});