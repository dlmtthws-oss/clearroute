import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Active-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const getCustomersWithActivity = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data } = await supabase
    .from("customers")
    .select("id, name, service_type, created_at")
    .eq("profiles_id", userId)
    .eq("is_active", true)
    .neq("service_type", "one_off");
  return data || [];
};

const getCustomerSignals = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string) => {
  const { data } = await supabase.rpc("get_customer_risk_signals", { cust_id: customerId });
  return data?.[0] || null;
};

const getPaymentsHistory = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string) => {
  const { data: payments } = await supabase
    .from("payments")
    .select("created_at, amount, invoices!inner(due_date, customer_id)")
    .eq("invoices.customer_id", customerId)
    .gte("created_at", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false });

  const currentPeriod = (payments || []).filter((p: any) => 
    new Date(p.created_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  );
  const previousPeriod = (payments || []).filter((p: any) => 
    new Date(p.created_at) > new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) &&
    new Date(p.created_at) < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  );

  const currentDelay = currentPeriod.length > 0
    ? currentPeriod.reduce((sum: number, p: any) => {
      const due = new Date(p.invoices?.due_date || p.created_at);
      const paid = new Date(p.created_at);
      return sum + Math.max(0, Math.ceil((paid.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
    }, 0) / currentPeriod.length
    : 0;

  const previousDelay = previousPeriod.length > 0
    ? previousPeriod.reduce((sum: number, p: any) => {
      const due = new Date(p.invoices?.due_date || p.created_at);
      const paid = new Date(p.created_at);
      return sum + Math.max(0, Math.ceil((paid.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
    }, 0) / previousPeriod.length
    : 0;

  return {
    currentDelay,
    previousDelay,
    delayTrend: currentDelay - previousDelay,
    paymentCount: (payments || []).length,
    spendCurrent: currentPeriod.reduce((sum: number, p: any) => sum + Number(p.amount), 0),
    spendPrevious: previousPeriod.reduce((sum: number, p: any) => sum + Number(p.amount), 0)
  };
};

const getVisitHistory = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string) => {
  const { data: jobs } = await supabase
    .from("jobs")
    .select("completed_at, status, route_stops!inner(customer_id)")
    .eq("route_stops.customer_id", customerId)
    .gte("completed_at", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
    .order("completed_at", { ascending: false });

  const completed = (jobs || []).filter((j: any) => j.status === "completed");
  const currentPeriod = completed.filter((j: any) => 
    new Date(j.completed_at) > new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  ).length;
  const previousPeriod = completed.filter((j: any) => 
    new Date(j.completed_at) > new Date(Date.now() - 425 * 24 * 60 * 60 * 1000) &&
    new Date(j.completed_at) < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  ).length;

  const lastVisit = completed[0]?.completed_at 
    ? Math.floor((Date.now() - new Date(completed[0].completed_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  return { currentPeriod, previousPeriod, lastVisit, frequency: completed.length };
};

const getOutstanding = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string) => {
  const { data: invoices } = await supabase
    .from("invoices")
    .select("total, status")
    .eq("customer_id", customerId)
    .in("status", ["sent", "overdue"]);

  const outstanding = (invoices || []).reduce((sum: number, inv: any) => sum + Number(inv.total), 0);
  return outstanding;
};

const getMandateStatus = async (supabase: ReturnType<typeof createSupabaseClient>, customerId: string) => {
  const { data } = await supabase
    .from("gocardless_mandates")
    .select("status")
    .eq("customer_id", customerId)
    .eq("status", "active")
    .single();
  return !!data;
};

const calculateChurnScore = (signals: {
  daysSinceVisit: number;
  delayTrend: number;
  paymentDelayCurrent: number;
  spendTrend: number;
  outstanding: number;
  totalInvoiced: number;
  hasMandate: boolean;
}) => {
  let score = 0;
  const factors: string[] = [];

  const visitScore = Math.min(signals.daysSinceVisit / 120, 1) * 0.25;
  score += visitScore;
  if (signals.daysSinceVisit > 60) factors.push(`No visit in ${signals.daysSinceVisit} days`);
  else if (signals.daysSinceVisit > 30) factors.push(`Visit overdue (${signals.daysSinceVisit} days)`);

  const paymentScore = Math.min(Math.max(signals.delayTrend, 0) / 30, 1) * 0.20;
  score += paymentScore;
  if (signals.delayTrend > 7) factors.push(`Payment delays increasing (+${signals.delayTrend.toFixed(0)} days)`);

  const outstandingRatio = signals.totalInvoiced > 0 
    ? signals.outstanding / signals.totalInvoiced 
    : 0;
  const outstandingScore = Math.min(outstandingRatio * 2, 1) * 0.15;
  score += outstandingScore;
  if (signals.outstanding > 100) factors.push(`£${signals.outstanding.toFixed(0)} outstanding`);

  const spendScore = signals.spendTrend < -0.2 
    ? Math.abs(signals.spendTrend) * 0.25 
    : 0;
  score += spendScore;
  if (signals.spendTrend < -0.2) factors.push(`Spend down ${(signals.spendTrend * 100).toFixed(0)}%`);

  if (signals.hasMandate) {
    score -= 0.15;
  }

  return Math.max(0, Math.min(score, 1));
};

const getRiskLevel = (score: number) => {
  if (score >= 0.75) return "critical";
  if (score >= 0.50) return "high";
  if (score >= 0.30) return "medium";
  return "low";
};

const getClaudeAnalysis = async (customerName: string, signals: any) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey || getRiskLevel(signals.score) === "low") {
    return { analysis: "", actions: [], urgency: "this_month", keyFactor: "" };
  }

  const prompt = `You are a customer retention specialist for a UK window cleaning business. A customer is showing signs of potential churn.
Analyse these risk signals and provide:
1. A plain English explanation (2-3 sentences, specific to the data)
2. Up to 3 specific intervention actions ranked by effectiveness
3. An urgency level

Customer: ${customerName}
Signals:
- Days since last visit: ${signals.daysSinceVisit}
- Payment delay trend: ${signals.delayTrend > 0 ? '+' : ''}${signals.delayTrend.toFixed(0)} days
- Outstanding balance: £${signals.outstanding.toFixed(0)}
- Spend trend: ${(signals.spendTrend * 100).toFixed(0)}%
- Active direct debit: ${signals.hasMandate ? 'Yes' : 'No'}

Respond in JSON:
{
  analysis: string,
  actions: [{ action: string, rationale: string, urgency: string }],
  urgency: string,
  key_risk_factor: string
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
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) return { analysis: "", actions: [], urgency: "this_month", keyFactor: "" };

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    return JSON.parse(text);
  } catch {
    return { analysis: "", actions: [], urgency: "this_month", keyFactor: "" };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabase = createSupabaseClient(req);
  const userId = req.headers.get("x-user-id");

  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const customers = await getCustomersWithActivity(supabase, userId);
    const results = [];
    const today = new Date().toISOString().split("T")[0];

    for (const customer of customers) {
      const createdMs = new Date(customer.created_at).getTime();
      if (Date.now() - createdMs < 60 * 24 * 60 * 60 * 1000) continue;

      const [payments, visits, outstanding, hasMandate] = await Promise.all([
        getPaymentsHistory(supabase, customer.id),
        getVisitHistory(supabase, customer.id),
        getOutstanding(supabase, customer.id),
        getMandateStatus(supabase, customer.id)
      ]);

      const signals = {
        daysSinceVisit: visits.lastVisit,
        delayTrend: payments.delayTrend,
        paymentDelayCurrent: payments.currentDelay,
        spendTrend: payments.spendPrevious > 0 
          ? (payments.spendCurrent - payments.spendPrevious) / payments.spendPrevious 
          : 0,
        outstanding,
        totalInvoiced: payments.spendCurrent + payments.spendPrevious,
        hasMandate
      };

      const score = calculateChurnScore(signals);
      const riskLevel = getRiskLevel(score);
      const factors: string[] = [];
      if (signals.daysSinceVisit > 30) factors.push("Overdue visit");
      if (signals.delayTrend > 0) factors.push("Payment delays");
      if (signals.outstanding > 0) factors.push("Outstanding balance");
      if (signals.spendTrend < 0) factors.push("Spend declining");

      const { data: prevScoreData } = await supabase
        .from("customer_churn_scores")
        .select("churn_score")
        .eq("customer_id", customer.id)
        .order("score_date", { ascending: false })
        .limit(1)
        .single();
      const previousScore = prevScoreData?.churn_score || null;

      let aiAnalysis: any = { analysis: "", actions: [], urgency: "this_month", keyFactor: "" };
      if (riskLevel !== "low") {
        aiAnalysis = await getClaudeAnalysis(customer.name, { ...signals, score });
      }

      await supabase.from("customer_churn_scores").insert({
        customer_id: customer.id,
        user_id: userId,
        churn_score: score,
        risk_level: riskLevel,
        risk_factors: factors,
        ai_analysis: aiAnalysis.analysis,
        suggested_actions: aiAnalysis.actions || [],
        score_date: today,
        previous_score: previousScore,
        score_change: previousScore ? score - previousScore : null
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        calculated: results.length,
        summary: {
          critical: results.filter((r: any) => r.riskLevel === "critical").length,
          high: results.filter((r: any) => r.riskLevel === "high").length,
          medium: results.filter((r: any) => r.riskLevel === "medium").length,
          low: results.filter((r: any) => r.riskLevel === "low").length
        }
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