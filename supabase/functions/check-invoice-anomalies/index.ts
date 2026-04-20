import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const checkDuplicate = async (supabase: ReturnType<typeof createSupabaseClient>, invoiceId: string) => {
  const { data: invoice } = await supabase.from("invoices").select("*, customers(name)").eq("id", invoiceId).single();
  if (!invoice) return null;

  const { data: duplicates } = await supabase.rpc("find_duplicate_invoices", { invoice_id: invoiceId });
  if (duplicates && duplicates.length > 0) {
    const dup = duplicates[0];
    return {
      anomaly_type: "duplicate_suspected",
      severity: "warning",
      title: "Possible Duplicate Invoice",
      description: `Invoice ${invoice.invoice_number} has the same amount (£${invoice.total}) for ${invoice.customers?.name} and was created within 7 days of ${dup.invoice_number}.`,
      suggested_action: "Review both invoices and delete the duplicate before sending."
    };
  }
  return null;
};

const checkUnusualAmount = async (supabase: ReturnType<typeof createSupabaseClient>, invoice: any) => {
  if (!invoice.customer_id) return null;

  const { data: avg } = await supabase.rpc("get_customer_avg_invoice", { cust_id: invoice.customer_id });
  const average = avg || 0;

  if (average > 0) {
    const ratio = invoice.total / average;
    if (ratio > 2) {
      return {
        anomaly_type: "amount_unusual",
        severity: "warning",
        title: "Invoice Amount Higher Than Usual",
        description: `This invoice (£${invoice.total}) is ${ratio.toFixed(1)}x higher than ${invoice.customers?.name}'s average of £${average.toFixed(2)}.`,
        suggested_action: "Confirm the amount is correct before sending."
      };
    } else if (ratio < 0.3 && average > 50) {
      return {
        anomaly_type: "amount_unusual",
        severity: "info",
        title: "Invoice Amount Lower Than Usual",
        description: `This invoice (£${invoice.total}) is significantly lower than usual for ${invoice.customers?.name}.`,
        suggested_action: null
      };
    }
  }
  return null;
};

const checkVatCalculation = async (supabase: ReturnType<typeof createSupabaseClient>, invoice: any) => {
  const { data: lineItems } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoice.id);
  if (!lineItems || lineItems.length === 0) return null;

  for (const line of lineItems) {
    const expectedVat = (line.quantity * line.unit_price * (parseFloat(line.vat_rate) / 100));
    const actualVat = line.vat_amount || 0;
    if (Math.abs(expectedVat - actualVat) > 0.02) {
      return {
        anomaly_type: "vat_calculation_error",
        severity: "error",
        title: "VAT Calculation Error Detected",
        description: `The VAT on line "${line.description?.slice(0, 30)}" appears incorrect. Expected £${expectedVat.toFixed(2)}, found £${actualVat.toFixed(2)}.`,
        suggested_action: "Edit the invoice and recalculate VAT before sending.",
        extra_data: { line_id: line.id, expected: expectedVat, actual: actualVat }
      };
    }
  }

  const expectedInvoiceVat = lineItems.reduce((sum, l) => sum + (l.quantity * l.unit_price * (parseFloat(l.vat_rate) / 100)), 0);
  const actualInvoiceVat = parseFloat(invoice.vat_amount) || 0;
  if (Math.abs(expectedInvoiceVat - actualInvoiceVat) > 0.02 && invoice.vat_amount) {
    return {
      anomaly_type: "vat_calculation_error",
      severity: "error",
      title: "Total VAT Calculation Error",
      description: `Invoice VAT (£${actualInvoiceVat.toFixed(2)}) doesn't match sum of line items (£${expectedInvoiceVat.toFixed(2)}).`,
      suggested_action: "Recalculate the invoice VAT."
    };
  }

  return null;
};

const checkDuplicateLineItems = async (supabase: ReturnType<typeof createSupabaseClient>, invoice: any) => {
  const { data: lineItems } = await supabase.from("invoice_line_items").select("description, unit_price").eq("invoice_id", invoice.id);
  if (!lineItems || lineItems.length < 2) return null;

  const seen = new Map<string, number>();
  for (const line of lineItems) {
    const key = `${line.description}-${line.unit_price}`;
    if (seen.has(key)) {
      return {
        anomaly_type: "duplicate_line_item",
        severity: "warning",
        title: "Duplicate Line Item",
        description: `"${line.description}" appears twice on this invoice with the same amount. Is this intentional?`,
        suggested_action: "Combine the quantities or confirm this is intentional."
      };
    }
    seen.set(key, 1);
  }
  return null;
};

const checkMissingVat = async (supabase: ReturnType<typeof createSupabaseClient>, invoice: any) => {
  const { data: lineItems } = await supabase.from("invoice_line_items").select("description, vat_rate").eq("invoice_id", invoice.id);
  if (!lineItems) return null;

  const taxableKeywords = ["cleaning", "service", "maintenance", "window", "wash", "gutter", "fascia"];
  for (const line of lineItems) {
    if (parseFloat(line.vat_rate) === 0) {
      const isTaxable = taxableKeywords.some(k => line.description?.toLowerCase().includes(k));
      if (isTaxable) {
        return {
          anomaly_type: "missing_vat",
          severity: "warning",
          title: "Possible Missing VAT",
          description: `Line item "${line.description}" appears to be a taxable service but has 0% VAT applied.`,
          suggested_action: "Confirm this line item should be zero-rated."
        };
      }
    }
  }
  return null;
};

const checkPricingInconsistency = async (supabase: ReturnType<typeof createSupabaseClient>, invoice: any) => {
  if (!invoice.customer_id) return null;

  const { data: lineItems } = await supabase.from("invoice_line_items").select("description, unit_price").eq("invoice_id", invoice.id);
  if (!lineItems || lineItems.length === 0) return null;

  for (const line of lineItems) {
    if (line.unit_price > 0 && line.description) {
      const { data: history } = await supabase.rpc("get_historical_price", {
        cust_id: invoice.customer_id,
        desc_pattern: line.description.slice(0, 20)
      });

      if (history && history.length > 0) {
        const oldPrice = parseFloat(history[0].unit_price);
        const newPrice = parseFloat(line.unit_price);
        const change = oldPrice > 0 ? Math.abs((newPrice - oldPrice) / oldPrice) : 0;

        if (change > 0.2) {
          return {
            anomaly_type: "pricing_inconsistency",
            severity: "info",
            title: "Price Change from Previous Invoice",
            description: `"${line.description}" was £${oldPrice.toFixed(2)} previously, now £${newPrice.toFixed(2)} (${(change * 100).toFixed(0)}% change).`,
            suggested_action: "Confirm this price change is intentional."
          };
        }
      }
    }
  }
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabase = createSupabaseClient(req);

  try {
    const { invoice_id, run_all } = await req.json();

    if (!invoice_id && !run_all) {
      return new Response(JSON.stringify({ error: "invoice_id required" }), { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } });
    }

    const anomalies: any[] = [];

    if (invoice_id) {
      const { data: invoice } = await supabase.from("invoices").select("*, customers(name)").eq("id", invoice_id).single();

      if (invoice) {
        if (invoice.status === "draft" || invoice.status === "sent") {
          const checks = await Promise.all([
            checkDuplicate(supabase, invoice_id),
            checkUnusualAmount(supabase, invoice),
            checkVatCalculation(supabase, invoice),
            checkDuplicateLineItems(supabase, invoice),
            checkMissingVat(supabase, invoice),
            checkPricingInconsistency(supabase, invoice)
          ]);

          for (const check of checks) {
            if (check) anomalies.push(check);
          }

          if (anomalies.length > 0) {
            await supabase.from("invoice_anomalies").delete().eq("invoice_id", invoice_id).eq("status", "open");
            await supabase.from("invoice_anomalies").insert(
              anomalies.map(a => ({
                invoice_id,
                ...a
              }))
            );
          } else {
            await supabase.from("invoice_anomalies").delete().eq("invoice_id", invoice_id);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, anomalies }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } });
  }
});