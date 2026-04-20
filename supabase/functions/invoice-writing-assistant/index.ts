import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const DEFAULT_TEMPLATES = [
  { service_type: 'window_cleaning', description_template: 'Window Cleaning — External', typical_quantity: 1, typical_unit_price: 10, created_by: 'ai' },
  { service_type: 'window_cleaning', description_template: 'Window Cleaning — Internal and External', typical_quantity: 1, typical_unit_price: 18, created_by: 'ai' },
  { service_type: 'gutter_cleaning', description_template: 'Gutter Cleaning', typical_quantity: 1, typical_unit_price: 25, created_by: 'ai' },
  { service_type: 'conservatory', description_template: 'Conservatory Roof Cleaning', typical_quantity: 1, typical_unit_price: 40, created_by: 'ai' },
  { service_type: 'solar', description_template: 'Solar Panel Cleaning', typical_quantity: 1, typical_unit_price: 30, created_by: 'ai' },
  { service_type: 'frame_sill', description_template: 'Frame and Sill Cleaning', typical_quantity: 1, typical_unit_price: 8, created_by: 'ai' },
];

const suggestLineItems = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string, routeId?: string, jobExecutionIds?: string[]) => {
  const { data: customer } = await supabase.from("customers").select("*, profiles_id").eq("id", customerId).single();
  if (!customer) return { error: "Customer not found" };

  const { data: pastInvoices } = await supabase.from("invoices")
    .select("id, invoice_number, issue_date, total, invoice_line_items(description, quantity, unit_price, vat_rate)")
    .eq("customer_id", customerId)
    .order("issue_date", { ascending: false })
    .limit(5);

  let routeData = null;
  if (routeId) {
    ({ data: routeData } = await supabase.from("routes").select("*, route_stops(*, customers(*))").eq("id", routeId).single());
  }

  let jobData: any[] = [];
  if (jobExecutionIds && jobExecutionIds.length > 0) {
    ({ data: jobData } = await supabase.from("jobs").select("*, route_stops(customers(name))").in("id", jobExecutionIds));
  }

  const pastLineItems = pastInvoices?.flatMap((inv: any) => inv.invoice_line_items || []) || [];
  const typicalItems = pastLineItems.slice(0, 10);

  const recentInvoices = pastInvoices?.slice(0, 3) || [];
  const invoiceSummary = recentInvoices.length > 0
    ? recentInvoices.map((i: any) => `Invoice ${i.invoice_number} (${i.issue_date}): £${i.total}`).join(", ")
    : "No previous invoices";

  const prompt = `You are an invoice writing assistant for a UK window cleaning business.

Generate appropriate invoice line items based on this data:
Customer: ${customer.name}
Service address: ${customer.address_line_1}, ${customer.city}, ${customer.postcode}
${routeData ? `Route: ${routeData.name} on ${routeData.scheduled_date}` : ''}
Jobs executed: ${jobData?.map((j: any) => `${j.route_stops?.customers?.name || 'Unknown'}: ${j.actual_minutes || j.estimated_minutes}min`).join(", ") || 'None'}
Previous invoices for ${customer.name}: ${invoiceSummary}
Typical line items: ${typicalItems.map((l: any) => `${l.description}: £${l.unit_price}`).join(", ") || 'None'}

Generate invoice line items in JSON:
[{
  description: string (professional, specific),
  quantity: number,
  unit: string (e.g. 'visit', 'hour', 'property'),
  unit_price: number,
  vat_rate: number (20 for standard, 0 for zero-rated),
  reasoning: string (why you suggested this)
}]

Use customer's historical pricing as baseline. British English, professional descriptions.`;

  try {
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!claudeKey) {
      return { suggestions: typicalItems.length > 0 ? typicalItems : DEFAULT_TEMPLATES.map(t => ({ ...t, reasoning: 'Based on typical pricing' })) };
    }

    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, messages: [{ role: "user", content: prompt }] })
    });

    if (!response.ok) {
      return { suggestions: typicalItems.length > 0 ? typicalItems : DEFAULT_TEMPLATES.map(t => ({ ...t, reasoning: 'Based on typical pricing' })) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "[]";
    const suggestions = JSON.parse(text);
    return { suggestions };
  } catch {
    return { suggestions: typicalItems.length > 0 ? typicalItems : DEFAULT_TEMPLATES.map(t => ({ ...t, reasoning: 'Based on typical pricing' })) };
  }
};

const checkInvoiceCompleteness = async (supabase: ReturnType<typeof createSupabaseClient>, invoiceId: string) => {
  const { data: invoice } = await supabase.from("invoices").select("*, customers(*), invoice_line_items(*)").eq("id", invoiceId).single();
  if (!invoice) return { error: "Invoice not found" };

  const checks: any[] = [];
  const hasDescriptions = invoice.invoice_line_items?.every((l: any) => l.description?.trim());
  checks.push({ name: "All line items have descriptions", status: hasDescriptions ? "pass" : "fail" });

  const hasAllVat = invoice.invoice_line_items?.every((l: any) => l.vat_rate !== undefined);
  checks.push({ name: "VAT rate applied to all lines", status: hasAllVat ? "pass" : "fail" });

  const hasDueDate = invoice.due_date && new Date(invoice.due_date) > new Date();
  checks.push({ name: "Due date is in the future", status: hasDueDate ? "pass" : "warn" });

  const hasCustomerEmail = invoice.customers?.email;
  checks.push({ name: "Customer email on file", status: hasCustomerEmail ? "pass" : "warn" });

  const total = invoice.invoice_line_items?.reduce((sum, l) => sum + (l.quantity * l.unit_price), 0) || 0;
  const matchesTotal = Math.abs(total - invoice.total) < 0.01;
  checks.push({ name: "Invoice total matches line items", status: matchesTotal ? "pass" : "fail" });

  const isRoundTotal = invoice.total % 10 === 0;
  checks.push({ name: "Total is a round number (confirm intentional)", status: isRoundTotal ? "warn" : "pass", note: "May be an estimate" });

  const pastInvoices = await supabase.from("invoices").select("total").eq("customer_id", invoice.customer_id).neq("id", invoiceId).order("created_at", { ascending: false }).limit(3);
  const avgPast = pastInvoices?.data?.length ? pastInvoices.data.reduce((sum, i) => sum + Number(i.total || 0), 0) / pastInvoices.data.length : 0;
  const significantChange = avgPast > 0 && Math.abs(invoice.total - avgPast) / avgPast > 0.2;
  checks.push({ name: "Pricing consistent with history", status: significantChange ? "warn" : "pass", note: significantChange ? `Higher than customer's average ($${avgPast.toFixed(0)})` : undefined });

  let passCount = checks.filter((c: any) => c.status === "pass").length;
  let failCount = checks.filter((c: any) => c.status === "fail").length;
  let assessment = failCount > 0 ? "Invoice has issues that need resolution before sending." : passCount === checks.length ? "Invoice looks complete and ready to send." : "Invoice is mostly complete — review warnings above.";

  return {
    checks,
    assessment,
    invoice: { id: invoice.id, number: invoice.invoice_number, total: invoice.total }
  };
};

const suggestPrice = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string, serviceDescription: string) => {
  const { data: pastInvoices } = await supabase.from("invoices")
    .select("invoice_line_items(description, unit_price)")
    .eq("customer_id", customerId)
    .order("issue_date", { ascending: false })
    .limit(20);

  const relevantItems = (pastInvoices || []).flatMap((inv: any) => inv.invoice_line_items || [])
    .filter((l: any) => l.description?.toLowerCase().includes(serviceDescription.toLowerCase()));

  if (relevantItems.length >= 2) {
    const prices = relevantItems.map((l) => l.unit_price);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      suggested_price: avg,
      basis: `Based on ${relevantItems.length} previous invoices for this customer ($${min.toFixed(2)}-$${max.toFixed(2)})`,
      range: { min, max }
    };
  }

  const { data: templates } = await supabase.from("invoice_templates_ai")
    .select("typical_unit_price, usage_count")
    .ilike("description_template", `%${serviceDescription}%`)
    .order("usage_count", { ascending: false })
    .limit(1);

  if (templates?.length > 0) {
    return {
      suggested_price: templates[0].typical_unit_price,
      basis: "Based on typical service pricing",
      range: null
    };
  }

  return { suggested_price: 10, basis: "Using default rate", range: null };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createSupabaseClient(req);

  try {
    const { action, customer_id, route_id, job_execution_ids, invoice_id, service_description } = await req.json();

    if (action === "suggest-line-items") {
      const result = await suggestLineItems(supabase, customer_id, route_id, job_execution_ids);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "check-completeness") {
      const result = await checkInvoiceCompleteness(supabase, invoice_id);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "suggest-price") {
      const result = await suggestPrice(supabase, customer_id, service_description);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});