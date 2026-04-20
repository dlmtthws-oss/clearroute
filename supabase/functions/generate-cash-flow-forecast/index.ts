import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ForecastDay {
  date: string;
  expectedRevenue: number;
  expectedExpenses: number;
  balance: number;
  confidence: number;
  sources: string[];
}

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const getHistoricalPatterns = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data: payments } = await supabase
    .from("payments")
    .select("created_at, amount, invoices!inner(customer_id, status)")
    .eq("invoices.status", "paid")
    .gte("created_at", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
    .eq("invoices.profiles_id", userId);

  const { data: expenses } = await supabase
    .from("expenses")
    .select("expense_date, amount")
    .eq("profiles_id", userId)
    .gte("expense_date", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .eq("profiles_id", userId);

  const monthlyRevenue: Record<string, number> = {};
  const monthlyExpenses: Record<string, number> = {};
  
  (payments || []).forEach((p: { created_at: string; amount: number }) => {
    const month = p.created_at.slice(0, 7);
    monthlyRevenue[month] = (monthlyRevenue[month] || 0) + Number(p.amount);
  });

  (expenses || []).forEach((e: { expense_date: string; amount: number }) => {
    const month = e.expense_date.slice(0, 7);
    monthlyExpenses[month] = (monthlyExpenses[month] || 0) + Number(e.amount);
  });

  const avgMonthlyRevenue = Object.values(monthlyRevenue).reduce((a, b) => a + b, 0) / Math.max(Object.keys(monthlyRevenue).length, 1);
  const avgMonthlyExpenses = Object.values(monthlyExpenses).reduce((a, b) => a + b, 0) / Math.max(Object.keys(monthlyExpenses).length, 1);

  const seasonalFactors: Record<number, number> = { 0: 0.9, 1: 0.9, 2: 1.0, 3: 1.1, 4: 1.2, 5: 1.2, 6: 1.1, 7: 1.0, 8: 0.9, 9: 0.9, 10: 0.85, 11: 0.85 };

  return { avgMonthlyRevenue, avgMonthlyExpenses, seasonalFactors, customerCount: customers?.length || 0 };
};

const getOutstandingInvoices = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, due_date, customers(name)")
    .eq("profiles_id", userId)
    .in("status", ["sent", "overdue"])
    .order("due_date", { ascending: true });

  const outstanding = (invoices || []).map((inv: { id: string; invoice_number: string; total: number; due_date: string; customers: { name: string } }) => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    amount: Number(inv.total),
    dueDate: inv.due_date,
    customerName: inv.customers?.name,
    reliability: 0.7
  }));

  return outstanding;
};

const getRecurringInvoices = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data: recurring } = await supabase
    .from("recurring_invoices")
    .select("id, customer_id, amount, frequency, next_run_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("next_run_date", new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);

  return (recurring || []).map((r: { id: string; customer_id: string; amount: number; frequency: string; next_run_date: string }) => ({
    id: r.id,
    amount: Number(r.amount),
    frequency: r.frequency,
    nextRunDate: r.next_run_date
  }));
};

const getExpenses = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data: expenses } = await supabase
    .from("expenses")
    .select("expense_date, amount")
    .eq("profiles_id", userId)
    .in("status", ["pending", "approved"])
    .gte("expense_date", new Date().toISOString().split("T")[0]);

  return (expenses || []).map((e: { expense_date: string; amount: number }) => ({
    date: e.expense_date,
    amount: Number(e.amount)
  }));
};

const generateForecast = (
  historical: { avgMonthlyRevenue: number; avgMonthlyExpenses: number; seasonalFactors: Record<number, number> },
  recurringInvoices: { amount: number; nextRunDate: string }[],
  outstanding: { amount: number; dueDate: string }[],
  scheduledExpenses: { date: string; amount: number }[]
): ForecastDay[] => {
  const forecast: ForecastDay[] = [];
  const today = new Date();
  let runningBalance = 1000;
  const dailyRevenue = historical.avgMonthlyRevenue / 30;
  const dailyExpenses = historical.avgMonthlyExpenses / 30;

  for (let i = 0; i < 90; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];
    const month = date.getMonth();

    let expectedRevenue = dailyRevenue * (historical.seasonalFactors[month] || 1);
    let expectedExpenses = dailyExpenses;
    const sources: string[] = ["historical average"];

    const dueRecurring = recurringInvoices.filter(r => r.nextRunDate === dateStr);
    dueRecurring.forEach(r => {
      expectedRevenue += r.amount;
      sources.push("recurring invoice");
    });

    const dueOutstanding = outstanding.filter(o => o.dueDate === dateStr);
    dueOutstanding.forEach(o => {
      expectedRevenue += o.amount * 0.7;
      sources.push(`outstanding invoice (${o.customerName})`);
    });

    const dueExpenses = scheduledExpenses.filter(e => e.date === dateStr);
    dueExpenses.forEach(e => {
      expectedExpenses += e.amount;
      sources.push("scheduled expense");
    });

    const confidence = i < 30 ? 0.85 : i < 60 ? 0.7 : 0.5;
    runningBalance += expectedRevenue - expectedExpenses;

    forecast.push({
      date: dateStr,
      expectedRevenue: Math.round(expectedRevenue * 100) / 100,
      expectedExpenses: Math.round(expectedExpenses * 100) / 100,
      balance: Math.round(runningBalance * 100) / 100,
      confidence,
      sources
    });
  }

  return forecast;
};

const generateAISummary = async (forecast: ForecastDay[], avgRevenue: number) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) {
    return { summary: "AI analysis unavailable - API key not configured", recommendations: [], riskPeriods: [], positiveTrends: [] };
  }

  const recentForecast = forecast.slice(0, 30);
  const totalExpected = recentForecast.reduce((sum, d) => sum + d.expectedRevenue, 0);
  const avgDaily = totalExpected / 30;
  const minBalance = Math.min(...forecast.map(d => d.balance));
  const maxBalance = Math.max(...forecast.map(d => d.balance));
  const lowDays = forecast.filter(d => d.balance < 500).length;

  const prompt = `You are a financial analyst for a small UK window cleaning business. Based on this cash flow forecast data, provide:
1. A plain English summary (2-3 sentences) of the business's financial outlook
2. Up to 5 specific actionable recommendations
3. Identification of any concerning periods
4. Any positive trends to note

Forecast data:
- Average daily expected revenue: £${avgDaily.toFixed(2)}
- Minimum balance in next 90 days: £${minBalance.toFixed(2)}
- Maximum balance in next 90 days: £${maxBalance.toFixed(2)}
- Days with balance under £500: ${lowDays}
- Total expected revenue next 30 days: £${totalExpected.toFixed(2)}

Respond in JSON format:
{
  summary: string,
  recommendations: [{ priority: string, recommendation: string, action: string }],
  risk_periods: [{ start_date: string, end_date: string, reason: string, severity: string }],
  positive_trends: string[]
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
        system: "You are a financial analyst. Respond only with valid JSON.",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return { summary: "AI analysis unavailable", recommendations: [], riskPeriods: [], positiveTrends: [] };
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || "{}";
    
    try {
      return JSON.parse(content);
    } catch {
      return { summary: content.slice(0, 200), recommendations: [], riskPeriods: [], positiveTrends: [] };
    }
  } catch {
    return { summary: "AI analysis unavailable", recommendations: [], riskPeriods: [], positiveTrends: [] };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabase = createSupabaseClient(req);
  const authHeader = req.headers.get("authorization");
  
  let userId = req.headers.get("x-user-id");
  if (!userId && authHeader) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    userId = user?.id;
  }

  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const historical = await getHistoricalPatterns(supabase, userId);
    const outstanding = await getOutstandingInvoices(supabase, userId);
    const recurring = await getRecurringInvoices(supabase, userId);
    const scheduledExpenses = await getExpenses(supabase, userId);

    const forecast = generateForecast(historical, recurring, outstanding, scheduledExpenses);

    const aiAnalysis = await generateAISummary(forecast, historical.avgMonthlyRevenue / 30);

    const avgConfidence = forecast.reduce((sum, d) => sum + d.confidence, 0) / forecast.length;

    const { error: insertError } = await supabase.from("cash_flow_forecasts").insert({
      user_id: userId,
      forecast_date: new Date().toISOString().split("T")[0],
      period_start: new Date().toISOString().split("T")[0],
      period_end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      forecast_data: forecast,
      assumptions: {
        avgMonthlyRevenue: historical.avgMonthlyRevenue,
        avgMonthlyExpenses: historical.avgMonthlyExpenses,
        seasonalFactors: historical.seasonalFactors,
        recurringCount: recurring.length,
        outstandingCount: outstanding.length
      },
      confidence_score: avgConfidence,
      ai_summary: aiAnalysis.summary,
      ai_recommendations: aiAnalysis.recommendations
    });

    if (insertError) {
      console.error("Forecast insert error:", insertError);
    }

    return new Response(
      JSON.stringify({
        forecast,
        aiAnalysis,
        summary: aiAnalysis.summary,
        confidence: avgConfidence,
        riskPeriods: aiAnalysis.risk_periods,
        recommendations: aiAnalysis.recommendations
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});