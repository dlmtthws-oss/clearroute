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

const getOverdueCustomers = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data } = await supabase.rpc("get_overdue_customers", { days_threshold: 28 });
  return data || [];
};

const getWorkerWorkload = async (supabase: ReturnType<typeof createSupabaseClient>) => {
  const { data } = await supabase.rpc("get_worker_workload");
  return data || [];
};

const getScheduleGaps = async (supabase: ReturnType<typeof createSupabaseClient>) => {
  const { data } = await supabase.rpc("get_schedule_gaps");
  return data || [];
};

const getUpcomingRoutes = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data } = await supabase
    .from("routes")
    .select("id, name, scheduled_date, worker_id, estimated_minutes, profiles(name)")
    .eq("profiles_id", userId)
    .gte("scheduled_date", new Date().toISOString().split("T")[0])
    .lte("scheduled_date", new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("scheduled_date", { ascending: true });
  return (data || []).map((r: any) => ({
    ...r,
    workerName: r.profiles?.name
  }));
};

const getRouteStopHistory = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string) => {
  const { data } = await supabase
    .from("route_stops")
    .select("id, customer_id, route_id, stop_order, routes(scheduled_date, worker_id)")
    .in("route_id", [...(await supabase.from("routes").select("id").eq("profiles_id", userId).map((r: any) => r.id) || [])])
    .order("routes.scheduled_date", { ascending: false })
    .limit(500);
  return data || [];
};

const callClaude = async (prompt: string) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) return [];

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
        max_tokens: 2000,
        system: "You are a scheduling assistant for a UK window cleaning business. Respond only with valid JSON array.",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) return [];

    const result = await response.json();
    const text = result.content?.[0]?.text || "[]";
    return JSON.parse(text);
  } catch {
    return [];
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
    const [overdue, workload, gaps, upcoming] = await Promise.all([
      getOverdueCustomers(supabase, userId),
      getWorkerWorkload(supabase),
      getScheduleGaps(supabase),
      getUpcomingRoutes(supabase, userId)
    ]);

    const avgJobsPerWorker = workload.length > 0 
      ? workload.reduce((sum: number, w: any) => sum + w.jobs_scheduled, 0) / workload.length 
      : 0;

    const workloadDeviation = workload.map((w: any) => ({
      ...w,
      deviationFromAvg: w.jobs_scheduled - avgJobsPerWorker,
      isOverloaded: w.jobs_scheduled > avgJobsPerWorker * 1.3,
      isUnderloaded: w.jobs_scheduled < avgJobsPerWorker * 0.7
    }));

    const prompt = `You are a scheduling assistant for a UK window cleaning business. Analyse this schedule data and generate up to 8 specific, actionable scheduling suggestions.

Data:
- Overdue customers (not visited in 28+ days): ${JSON.stringify(overdue.slice(0, 10))}
- Worker workload next 14 days: ${JSON.stringify(workloadDeviation)}
- Schedule gaps (workers with under 6 hours): ${JSON.stringify(gaps.slice(0, 10))}
- Upcoming routes: ${JSON.stringify(upcoming.slice(0, 10))}
- Average jobs per worker: ${avgJobsPerWorker.toFixed(1)}

For each suggestion provide:
{
  "suggestion_type": "fill_gap" | "overdue_visit" | "rebalance_workload" | "new_customer_placement",
  "title": "short action title (max 10 words)",
  "description": "specific recommendation",
  "priority": "high" | "medium" | "low",
  "reasoning": "brief explanation",
  "estimated_duration_minutes": number or null,
  "suggested_customer_ids": [],
  "suggested_date": "YYYY-MM-DD" or null,
  "suggested_worker_id": string or null
}

Respond only with a JSON array, no other text.`;

    const suggestions = await callClaude(prompt);

    if (suggestions.length > 0) {
      await supabase.from("scheduling_suggestions").delete().eq("user_id", userId).eq("status", "pending");
      
      const toInsert = suggestions.map((s: any) => ({
        user_id: userId,
        suggestion_type: s.suggestion_type || "overdue_visit",
        title: s.title || "Scheduling suggestion",
        description: s.description || "",
        priority: s.priority || "medium",
        ai_reasoning: s.reasoning || "",
        estimated_duration_minutes: s.estimated_duration_minutes || null,
        suggested_customer_ids: s.suggested_customer_ids || [],
        suggested_date: s.suggested_date || null,
        suggested_worker_id: s.suggested_worker_id || null
      }));

      if (toInsert.length > 0) {
        await supabase.from("scheduling_suggestions").insert(toInsert);
      }
    }

    return new Response(
      JSON.stringify({ 
        suggestions: suggestions.slice(0, 8),
        stats: {
          overdueCount: overdue.length,
          workloadDeviation: workloadDeviation.length,
          gapDays: gaps.length
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