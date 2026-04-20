import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const STRIPE_API = "https://api.stripe.com/v1";
const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreatePaymentIntentRequest {
  invoiceId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { invoiceId } = await req.json() as CreatePaymentIntentRequest;

    if (!invoiceId) {
      return new Response(
        JSON.stringify({ error: "Invoice ID required" }),
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

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*, customers(name, email, portal_token), profiles(company_name)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invoice.status === "paid") {
      return new Response(
        JSON.stringify({ error: "Invoice is already paid" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const companyName = invoice.profiles?.company_name || "ClearRoute";
    const amountInPence = Math.round(invoice.total * 100);
    const idempotencyKey = `${invoiceId}-${Date.now()}`;

    const formData = new URLSearchParams();
    formData.append("amount", amountInPence.toString());
    formData.append("currency", "gbp");
    formData.append("metadata[invoice_id]", invoiceId);
    formData.append("metadata[invoice_number]", invoice.invoice_number);
    formData.append("metadata[customer_id]", invoice.customer_id || "");
    formData.append("description", `Invoice ${invoice.invoice_number} - ${companyName}`);

    if (invoice.customers?.email) {
      formData.append("receipt_email", invoice.customers.email);
    }

    const response = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Stripe error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to create payment intent" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const paymentIntent = await response.json() as {
      id: string;
      client_secret: string;
    };

    await supabase
      .from("invoices")
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        card_payment_status: "pending",
      })
      .eq("id", invoiceId);

    await supabase.from("stripe_payments").insert({
      invoice_id: invoiceId,
      stripe_payment_intent_id: paymentIntent.id,
      amount: invoice.total,
      status: "pending",
      customer_email: invoice.customers?.email,
      customer_name: invoice.customers?.name,
    });

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Create payment intent error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to create payment intent" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});