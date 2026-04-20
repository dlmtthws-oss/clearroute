import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const STRIPE_API = "https://api.stripe.com/v1";
const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefundRequest {
  stripePaymentIntentId: string;
  amount?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { stripePaymentIntentId, amount } = await req.json() as RefundRequest;

    if (!stripePaymentIntentId) {
      return new Response(
        JSON.stringify({ error: "Payment Intent ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get payment record
    const { data: payment, error: paymentError } = await supabase
      .from("stripe_payments")
      .select("*, invoices(invoice_number, total)")
      .eq("stripe_payment_intent_id", stripePaymentIntentId)
      .single();

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (payment.status !== "succeeded") {
      return new Response(
        JSON.stringify({ error: "Can only refund successful payments" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const refundAmount = amount 
      ? Math.round(amount * 100) 
      : Math.round(payment.amount * 100);

    // Check if partial refund exceeds remaining
    if (payment.refunded_at) {
      return new Response(
        JSON.stringify({ error: "Payment already fully refunded" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = new URLSearchParams();
    formData.append("payment_intent", stripePaymentIntentId);
    if (amount) {
      formData.append("amount", refundAmount.toString());
    }

    const response = await fetch(`${STRIPE_API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Stripe refund error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Refund failed" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const refund = await response.json() as { id: string; amount: number; status: string };

    // Update stripe_payments
    const refundAmountPence = refund.amount / 100;
    await supabase
      .from("stripe_payments")
      .update({
        status: refundAmountPence >= payment.amount ? "refunded" : "succeeded",
        refunded_at: new Date().toISOString(),
        refund_amount: refundAmountPence,
      })
      .eq("stripe_payment_intent_id", stripePaymentIntentId);

    // Update invoice status if full refund
    if (payment.invoice_id) {
      if (refundAmountPence >= payment.amount) {
        await supabase
          .from("invoices")
          .update({ status: "sent", card_payment_status: "none" })
          .eq("id", payment.invoice_id);
      }

      const { data: invoice } = await supabase
        .from("invoices")
        .select("profiles_id, invoice_number")
        .eq("id", payment.invoice_id)
        .single();

      if (invoice) {
        await supabase.from("notifications").insert({
          user_id: invoice.profiles_id,
          title: "Refund Issued",
          body: `Refund of £${refundAmountPence.toFixed(2)} processed for invoice ${invoice.invoice_number}`,
          type: "payment",
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        refundId: refund.id,
        amount: refundAmountPence,
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Refund error:", error);
    return new Response(
      JSON.stringify({ error: "Refund failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});