import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const getRevenueMetrics = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, startDate: string, endDate: string) => {
  const { data: current } = await supabase.rpc('get_revenue_summary', { period: 'today', year_num: null, month_num: null });
  const { data: previous } = await supabase.from('payments').select('amount').eq('profiles_id', userId);
  return { revenue: current?.[0]?.total_revenue || 0, invoiceCount: current?.[0]?.invoice_count || 0 };
};

const getExpenseMetrics = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data } = await supabase.from('expenses').select('amount, category').eq('profiles_id', userId);
  const total = (data || []).reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
  return total;
};

const getRouteMetrics = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, startDate: string, endDate: string) => {
  const { data } = await supabase.from('routes').select('id, status, jobs_completed, jobs_skipped')
    .eq('profiles_id', userId)
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate);
  const completed = (data || []).filter((r: any) => r.status === 'completed').length;
  const total = (data || []).length;
  const skipped = (data || []).reduce((sum: number, r: any) => sum + (r.jobs_skipped || 0), 0);
  return { completed, total, skipped };
};

const getCustomerMetrics = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, startDate: string, endDate: string) => {
  const { data: newCustomers } = await supabase.from('customers').select('id').eq('profiles_id', userId).gte('created_at', startDate);
  const { data: activeCustomers } = await supabase.from('customers').select('id, invoices(id)')
    .eq('profiles_id', userId)
    .gte('created_at', '2024-01-01');
  const uniqueActive = new Set((activeCustomers || []).flatMap((c: any) => c.invoices?.length ? c.id : []));
  return { newCustomers: newCustomers?.length || 0, activeCustomers: uniqueActive.size };
};

const getCollectionMetrics = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, startDate: string, endDate: string) => {
  const { data: invoices } = await supabase.from('invoices').select('total, status').eq('profiles_id', userId).gte('issue_date', startDate);
  const totalInvoiced = (invoices || []).reduce((sum: number, i: any) => sum + Number(i.total || 0), 0);
  const paidInvoiced = (invoices || []).filter((i: any) => i.status === 'paid').reduce((sum: number, i: any) => sum + Number(i.total || 0), 0);
  return { collectionRate: totalInvoiced > 0 ? (paidInvoiced / totalInvoiced) * 100 : 0 };
};

const generateInsight = async (insightType: string, userId: string, companyName: string, startDate: string, endDate: string) => {
  const supabase = createSupabaseClient({ headers: { apikey: '' } } as Request);
  
  const [revenue, expenses, routes, customers, collection] = await Promise.all([
    getRevenueMetrics(supabase, userId, startDate, endDate),
    getExpenseMetrics(supabase, userId),
    getRouteMetrics(supabase, userId, startDate, endDate),
    getCustomerMetrics(supabase, userId, startDate, endDate),
    getCollectionMetrics(supabase, userId, startDate, endDate)
  ]);

  const metrics = {
    revenue: revenue.revenue,
    invoiceCount: revenue.invoiceCount,
    expenses,
    profit: revenue.revenue - expenses,
    profitMargin: revenue.revenue > 0 ? ((revenue.revenue - expenses) / revenue.revenue) * 100 : 0,
    routesCompleted: routes.completed,
    routesTotal: routes.total,
    skipRate: routes.total > 0 ? (routes.skipped / routes.total) * 100 : 0,
    newCustomers: customers.newCustomers,
    activeCustomers: customers.activeCustomers,
    collectionRate: collection.collectionRate
  };

  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) {
    return {
      headline: `Week of ${startDate} summary`,
      narrative: "AI insights unavailable - configure API key",
      highlights: [],
      concerns: [],
      recommendations: [],
      metrics: {}
    };
  }

  const periodLabel = insightType === 'weekly_summary' ? 'week' : insightType === 'monthly_review' ? 'month' : 'quarter';
  const prompt = `You are a business analyst writing a ${periodLabel} report for a UK window cleaning business called ${companyName || 'ClearRoute'}.

Write in a clear, professional but friendly tone. Use British English. Be specific with numbers.

Period: ${startDate} to ${endDate}
Metrics:
- Revenue: £${metrics.revenue.toFixed(2)} (${metrics.invoiceCount} invoices)
- Expenses: £${metrics.expenses.toFixed(2)}
- Profit: £${metrics.profit.toFixed(2)} (${metrics.profitMargin.toFixed(1)}% margin)
- Routes: ${metrics.routesCompleted} completed of ${metrics.routesTotal} scheduled
- Skip rate: ${metrics.skipRate.toFixed(1)}%
- New customers: ${metrics.newCustomers}
- Active customers: ${metrics.activeCustomers}
- Collection rate: ${metrics.collectionRate.toFixed(1)}%

Generate a report in JSON:
{
  headline: string (one sentence, the most important thing),
  narrative: string (2-4 paragraphs of business commentary),
  highlights: [{ title: string, detail: string, metric: string }],
  concerns: [{ title: string, detail: string, severity: string }],
  recommendations: [{ action: string, rationale: string, priority: string }]
}`;

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return {
        headline: `Summary unavailable`,
        narrative: "Failed to generate",
        highlights: [],
        concerns: [],
        recommendations: [],
        metrics
      };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    const result = JSON.parse(text);
    return { ...result, metrics };
  } catch {
    return {
      headline: `Summary unavailable`,
      narrative: "Error generating report",
      highlights: [],
      concerns: [],
      recommendations: [],
      metrics
    };
  }
};

const handleQuery = async (query: string, userId: string) => {
  const supabase = createSupabaseClient({ headers: { apikey: '' } } as Request);
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  
  const { data: revenueData } = await supabase.from('payments').select('created_at, amount, invoices!inner(customer_id, total)')
    .eq('profiles_id', userId)
    .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  const { data: customerData } = await supabase.from('customers').select('name, invoices(total, status)')
    .eq('profiles_id', userId);

  const { data: routeData } = await supabase.from('routes').select('name, status, scheduled_date, actual_minutes, estimated_minutes')
    .eq('profiles_id', userId)
    .gte('scheduled_date', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  const monthlyRevenue: Record<string, number> = {};
  (revenueData || []).forEach((r: any) => {
    const month = r.created_at.slice(0, 7);
    monthlyRevenue[month] = (monthlyRevenue[month] || 0) + Number(r.amount);
  });

  const topCustomers = (customerData || []).map((c: any) => ({
    name: c.name,
    total: c.invoices?.reduce((s: number, i: any) => s + Number(i.total || 0), 0) || 0
  })).sort((a, b) => b.total - a.total).slice(0, 10);

  const routePerformance = (routeData || []).map((r: any) => ({
    name: r.name,
    status: r.status,
    variance: r.actual_minutes && r.estimated_minutes ? r.actual_minutes - r.estimated_minutes : 0
  }));

  const prompt = `You are a business analyst. Answer this question about the business data.

Question: ${query}

Data available:
- Monthly revenue: ${JSON.stringify(monthlyRevenue)}
- Top customers: ${JSON.stringify(topCustomers.slice(0, 5))}
- Route performance: ${JSON.stringify(routePerformance.slice(0, 5))}

Answer the question specifically with numbers. Respond in plain English.`;

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) return "Unable to answer question";
    const data = await response.json();
    return data.content?.[0]?.text || "No answer available";
  } catch {
    return "Error processing question";
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabase = createSupabaseClient(req);
  const userId = req.headers.get("x-user-id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { insight_type, period_start, period_end, query } = await req.json();
    let result;

    if (query) {
      result = await handleQuery(query, userId);
      await supabase.from("report_queries").insert({
        user_id: userId,
        query_text: query,
        result_summary: result.slice(0, 500)
      });
      return new Response(JSON.stringify({ answer: result }), { headers: { ...CORSHeaders, "Content-Type": "application/json" } });
    }

    const { data: company } = await supabase.from("company_settings").select("company_name").eq("profiles_id", userId).single();
    result = await generateInsight(insight_type || 'weekly_summary', userId, company?.company_name || 'ClearRoute', period_start, period_end);

    await supabase.from("business_insights").insert({
      user_id: userId,
      insight_type: insight_type || 'weekly_summary',
      period_start,
      period_end,
      headline: result.headline,
      narrative: result.narrative,
      metrics: result.metrics,
      highlights: result.highlights,
      concerns: result.concerns,
      recommendations: result.recommendations
    });

    return new Response(JSON.stringify(result), { headers: { ...CORSHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } });
  }
});