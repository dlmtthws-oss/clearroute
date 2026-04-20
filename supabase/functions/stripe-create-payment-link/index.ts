import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const STRIPE_API = "https://api.stripe.com/v1";
const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreatePaymentLinkRequest {
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
    const { invoiceId } = await req.json() as CreatePaymentLinkRequest;

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

    // Load invoice with customer and company
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*, customers(name, email), profiles(company_name)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already paid
    if (invoice.status === "paid") {
      return new Response(
        JSON.stringify({ error: "Invoice is already paid" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check minimum amount (Stripe minimum is £0.30)
    if (invoice.total < 0.30) {
      return new Response(
        JSON.stringify({ error: "Invoice amount too small for card payment (minimum £0.30)" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // If payment link already exists and invoice unpaid, return existing
    if (invoice.stripe_payment_link_url && invoice.card_payment_status !== "succeeded") {
      return new Response(
        JSON.stringify({
          paymentLinkUrl: invoice.stripe_payment_link_url,
          existing: true,
        }),
        { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const companyName = invoice.profiles?.company_name || "ClearRoute";
    const amountInPence = Math.round(invoice.total * 100);

    // Create Stripe Payment Link
    const formData = new URLSearchParams();
    formData.append("line_items[0][price_data][currency]", "gbp");
    formData.append("line_items[0][price_data][unit_amount]", amountInPence.toString());
    formData.append("line_items[0][price_data][product_data][name]", `Invoice ${invoice.invoice_number}`);
    formData.append("line_items[0][price_data][product_data][description]", `${companyName} - Invoice ${invoice.invoice_number}`);
    formData.append("line_items[0][quantity]", "1");
    formData.append("payment_link_config[after_payment][redirect_url]", `${req.headers.get("origin")}/portal/${invoice.customers?.portal_token}/payment-success?invoice=${invoice.id}`);
    formData.append("payment_link_config[after_payment][redirect_cancel_url]", `${req.headers.get("origin")}/portal/${invoice.customers?.portal_token}`);
    formData.append("metadata[invoice_id]", invoiceId);
    formData.append("metadata[invoice_number]", invoice.invoice_number);
    formData.append("metadata[customer_id]", invoice.customer_id || "");

    const response = await fetch(`${STRIPE_API}/payment_links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Stripe error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to create payment link" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const paymentLink = await response.json() as {
      id: string;
      url: string;
    };

    // Store on invoice
    await supabase
      .from("invoices")
      .update({
        stripe_payment_link_id: paymentLink.id,
        stripe_payment_link_url: paymentLink.url,
        card_payment_status: "pending",
      })
      .eq("id", invoiceId);

    return new Response(
      JSON.stringify({
        paymentLinkUrl: paymentLink.url,
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Create payment link error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to create payment link" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});