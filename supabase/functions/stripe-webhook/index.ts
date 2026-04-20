import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  
  // Get raw body for signature verification
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  // Verify webhook signature (simplified - in production use stripe library)
  if (!signature || !webhookSecret) {
    console.error("Missing webhook secret or signature");
    return new Response(null, { status: 400, headers: CORSHeaders });
  }

  let event: StripeEvent;
  
  try {
    // In production, verify signature properly
    // For now, just parse the event
    event = JSON.parse(body);
  } catch (err) {
    console.error("Failed to parse webhook:", err);
    return new Response(null, { status: 400, headers: CORSHeaders });
  }

  console.log("Stripe webhook event:", event.type);

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as {
          id: string;
          amount: number;
          metadata: Record<string, string>;
        };
        
        const invoiceId = paymentIntent.metadata?.invoice_id;
        const amount = paymentIntent.amount / 100;

        if (invoiceId) {
          // Update stripe_payments
          await supabase
            .from("stripe_payments")
            .update({ status: "succeeded", paid_at: new Date().toISOString() })
            .eq("stripe_payment_intent_id", paymentIntent.id);

          // Get invoice to update status
          const { data: invoice } = await supabase
            .from("invoices")
            .select("*, customers(email)")
            .eq("id", invoiceId)
            .single();

          if (invoice) {
            // Update invoice
            await supabase
              .from("invoices")
              .update({ 
                status: "paid", 
                paid_at: new Date().toISOString(),
                card_payment_status: "succeeded"
              })
              .eq("id", invoiceId);

            // Record payment
            await supabase.from("payments").insert({
              invoice_id: invoiceId,
              amount: amount,
              payment_date: new Date().toISOString(),
              method: "card",
              reference: paymentIntent.id,
            });

            // Create notification
            await supabase.from("notifications").insert({
              user_id: invoice.profiles_id,
              title: "Payment Received",
              body: `Invoice ${invoice.invoice_number} paid by card - £${amount.toFixed(2)}`,
              type: "payment",
            });
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as {
          id: string;
          last_payment_error?: { message: string };
          metadata: Record<string, string>;
        };
        
        const invoiceId = paymentIntent.metadata?.invoice_id;

        // Update stripe_payments
        await supabase
          .from("stripe_payments")
          .update({ 
            status: "failed", 
            failure_reason: paymentIntent.last_payment_error?.message || "Payment failed" 
          })
          .eq("stripe_payment_intent_id", paymentIntent.id);

        // Update invoice
        if (invoiceId) {
          await supabase
            .from("invoices")
            .update({ card_payment_status: "failed" })
            .eq("id", invoiceId);

          // Get invoice for notification
          const { data: invoice } = await supabase
            .from("invoices")
            .select("profiles_id, invoice_number")
            .eq("id", invoiceId)
            .single();

          if (invoice) {
            await supabase.from("notifications").insert({
              user_id: invoice.profiles_id,
              title: "Payment Failed",
              body: `Card payment failed for invoice ${invoice.invoice_number}`,
              type: "error",
            });
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as {
          payment_intent: string;
          amount_refunded: number;
        };
        
        const refundAmount = charge.amount_refunded / 100;

        // Update stripe_payments
        await supabase
          .from("stripe_payments")
          .update({ 
            status: "refunded", 
            refunded_at: new Date().toISOString(),
            refund_amount: refundAmount
          })
          .eq("stripe_payment_intent_id", charge.payment_intent);

        // Get invoice and update status
        const { data: payment } = await supabase
          .from("stripe_payments")
          .select("invoice_id")
          .eq("stripe_payment_intent_id", charge.payment_intent)
          .single();

        if (payment?.invoice_id) {
          const { data: invoice } = await supabase
            .from("invoices")
            .select("profiles_id, invoice_number, total")
            .eq("id", payment.invoice_id)
            .single();

          // If full refund, set back to sent
          if (invoice && refundAmount >= invoice.total) {
            await supabase
              .from("invoices")
              .update({ status: "sent", card_payment_status: "none" })
              .eq("id", payment.invoice_id);
          }

          if (invoice) {
            await supabase.from("notifications").insert({
              user_id: invoice.profiles_id,
              title: "Refund Issued",
              body: `Refund of £${refundAmount.toFixed(2)} for invoice ${invoice.invoice_number}`,
              type: "payment",
            });
          }
        }
        break;
      }
    }

    return new Response(null, { status: 200, headers: CORSHeaders });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(null, { status: 200, headers: CORSHeaders });
  }
});