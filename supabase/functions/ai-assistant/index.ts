import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AssistantRequest {
  message: string;
  conversationId?: string;
  userId: string;
  context?: {
    currentPage?: string;
    routeId?: string;
  };
}

interface ToolResult {
  content: string;
  tool_use_id: string;
  type: string;
}

const SYSTEM_PROMPT = `You are ClearRoute Assistant, an AI helper for a window cleaning business management platform. You have access to the business's data through tool functions.

You can help with:
- Answering questions about customers, invoices, routes, payments and expenses
- Generating business insights and summaries
- Identifying patterns and anomalies
- Making scheduling and operational suggestions

Always be concise and business-focused.
Format currency as £X,XXX.XX
Format dates as DD/MM/YYYY
When showing lists, limit to top 5-10 items unless asked for more.
Never expose internal database IDs in responses.
If you cannot find data to answer a question, say so clearly rather than guessing.

You are also a COORDINATOR. Beyond answering questions, you can trigger the
business's own programs and AI agents, which are exposed to you as
"automations" (n8n workflows). Use list_automations to discover what is
available, then run_automation to prepare one. run_automation does NOT execute
immediately - it prepares the action and the user confirms it in the app before
it runs. Only prepare an automation that clearly matches the user's intent,
collect the parameters its schema requires, and briefly tell the user what you
have prepared and that they should confirm it. Never claim an action has already
run; it runs only after the user confirms.`;

const TOOLS = [
  {
    name: "get_revenue_summary",
    description: "Get revenue summary for a period (today/week/month/quarter/year)",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["today", "week", "month", "quarter", "year"] },
        year: { type: "number" },
        month: { type: "number" }
      },
      required: ["period"]
    }
  },
  {
    name: "get_outstanding_invoices",
    description: "Get list of outstanding invoices sorted by amount",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        min_days_overdue: { type: "number" }
      }
    }
  },
  {
    name: "get_customer_summary",
    description: "Get customer summary with totals and outstanding balances",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        limit: { type: "number" },
        sort_by: { type: "string", enum: ["revenue", "outstanding", "recent"] }
      }
    }
  },
  {
    name: "get_expense_summary",
    description: "Get expense summary by category for a period",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string" },
        category: { type: "string" }
      }
    }
  },
  {
    name: "get_worker_performance",
    description: "Get worker performance metrics",
    input_schema: {
      type: "object",
      properties: {
        worker_name: { type: "string" },
        period: { type: "string" }
      }
    }
  },
  {
    name: "list_automations",
    description: "List the programs and AI agents (automations) Jarvis can trigger for this business. Call this to discover what actions are available before proposing one.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "run_automation",
    description: "Prepare an automation (program or AI agent) to run. This does NOT execute it - it stages the action for the user to confirm in the app. Use the exact automation name from list_automations and provide params matching its input schema.",
    input_schema: {
      type: "object",
      properties: {
        automation_name: { type: "string", description: "Exact name from list_automations" },
        params: { type: "object", description: "Parameters for the automation, matching its input_schema" }
      },
      required: ["automation_name"]
    }
  }
];

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const callClaude = async (messages: { role: string; content: string }[], tools: unknown[], startTime: number) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) {
    return { error: "Claude API key not configured" };
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messages.slice(-10),
      tools,
      tool_choice: { type: "auto" }
    })
  });

  const duration = Date.now() - startTime;
  
  if (!response.ok) {
    const error = await response.text();
    return { error, duration };
  }

  const data = await response.json();
  return { ...data, duration };
};

const executeTool = async (
  supabase: ReturnType<typeof createSupabaseClient>,
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  proposals: Record<string, unknown>[],
) => {
  try {
    let result;

    switch (toolName) {
      case "list_automations": {
        const { data: automations } = await supabase
          .from("jarvis_automations")
          .select("id, name, description, category, input_schema, requires_confirmation")
          .eq("user_id", userId)
          .eq("enabled", true);
        result = (automations || []).map((a) => ({
          name: a.name,
          description: a.description,
          category: a.category,
          input_schema: a.input_schema,
        }));
        break;
      }
      case "run_automation": {
        const name = input.automation_name as string;
        const { data: automation } = await supabase
          .from("jarvis_automations")
          .select("id, name, description, category, requires_confirmation")
          .eq("user_id", userId)
          .eq("enabled", true)
          .ilike("name", name)
          .single();
        if (!automation) {
          result = { error: `No enabled automation named "${name}". Use list_automations to see options.` };
          break;
        }
        // Stage the action for user confirmation - do not execute here.
        proposals.push({
          automationId: automation.id,
          name: automation.name,
          description: automation.description,
          category: automation.category,
          params: (input.params as Record<string, unknown>) || {},
          requiresConfirmation: automation.requires_confirmation,
        });
        result = {
          staged: true,
          message: `Prepared "${automation.name}" for the user to confirm in the app. It has not run yet.`,
        };
        break;
      }
      case "get_revenue_summary": {
        const { data: revenue } = await supabase.rpc("get_revenue_summary", {
          period: input.period,
          year_num: input.year,
          month_num: input.month
        });
        result = revenue?.[0] || { total_revenue: 0, invoice_count: 0, avg_invoice_value: 0, previous_period_revenue: 0 };
        break;
      }
      case "get_outstanding_invoices": {
        const { data: invoices } = await supabase.rpc("get_outstanding_invoices", {
          limit_num: input.limit || 10,
          min_days: input.min_days_overdue || 0
        });
        result = invoices || [];
        break;
      }
      case "get_customer_summary": {
        const { data: customers } = await supabase.rpc("get_customer_summary", {
          customer_name: input.customer_name,
          limit_num: input.limit || 20,
          sort_by: input.sort_by || "revenue"
        });
        result = customers || [];
        break;
      }
      case "get_expense_summary": {
        const { data: expenses } = await supabase.rpc("get_expense_summary", {
          period: input.period,
          category: input.category
        });
        result = expenses?.[0] || { total_amount: 0, vat_reclaimable: 0, category_totals: {} };
        break;
      }
      case "get_worker_performance": {
        const { data: workers } = await supabase.rpc("get_worker_performance", {
          worker_name: input.worker_name,
          period: input.period
        });
        result = workers || [];
        break;
      }
      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    return result;
  } catch (err) {
    return { error: err.message };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const startTime = Date.now();
  const supabase = createSupabaseClient(req);

  try {
    const { message, conversationId, userId, context } = await req.json() as AssistantRequest;

    if (!message || !userId) {
      return new Response(
        JSON.stringify({ error: "Message and User ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    let convId = conversationId;
    
    if (!convId) {
      const { data: conv } = await supabase
        .from("ai_conversations")
        .insert({ user_id: userId, title: message.slice(0, 50) })
        .select()
        .single();
      
      if (conv) {
        convId = conv.id;
      }
    }

    await supabase.from("ai_messages").insert({
      conversation_id: convId,
      role: "user",
      content: message
    });

    const { data: history } = await supabase
      .from("ai_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(20);

    const conversationHistory = (history || []).map((m: { role: string; content: string; tool_results: unknown }) => ({
      role: m.role,
      content: m.tool_results ? JSON.stringify(m.tool_results) : m.content
    }));

    let contextMessage = "";
    if (context?.currentPage) {
      contextMessage = `\n\nCurrent page context: ${context.currentPage}`;
      if (context.routeId) {
        contextMessage += ` (Route ID: ${context.routeId})`;
      }
    }

    const fullMessage = message + contextMessage;

    const initialResponse = await callClaude(
      [...conversationHistory.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })), { role: "user", content: fullMessage }],
      TOOLS,
      startTime
    );

    if (initialResponse.error) {
      return new Response(
        JSON.stringify({ error: initialResponse.error }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const toolCalls = initialResponse.content?.filter((c: { type: string }) => c.type === "tool_use") || [];
    let toolResults: ToolResult[] = [];
    const proposedActions: Record<string, unknown>[] = [];

    for (const toolCall of toolCalls) {
      const input = toolCall.input || {};
      const result = await executeTool(supabase, toolCall.name, input as Record<string, unknown>, userId, proposedActions);
      toolResults.push({
        content: JSON.stringify(result),
        tool_use_id: toolCall.id,
        type: toolCall.name
      });
    }

    let finalResponse = initialResponse.content?.find((c: { type: string }) => c.type === "text")?.text || "";
    
    if (toolResults.length > 0) {
      const secondResponse = await callClaude(
        [
          ...conversationHistory.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          { role: "user", content: fullMessage },
          ...toolCalls.map((tc: { id: string; name: string; input: unknown }) => ({
            role: "assistant" as const,
            content: "",
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.input
          })),
          ...toolResults.map((tr) => ({
            role: "user" as const,
            content: "",
            type: "tool_result" as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content
          }))
        ],
        [],
        startTime
      );

      finalResponse = secondResponse.content?.find((c: { type: string }) => c.type === "text")?.text || finalResponse;
    }

    await supabase.from("ai_messages").insert({
      conversation_id: convId,
      role: "assistant",
      content: finalResponse,
      tool_calls: toolCalls.length > 0 ? toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input })) : null,
      tool_results: toolResults.length > 0 ? toolResults : null
    });

    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

    await supabase.from("ai_query_log").insert({
      user_id: userId,
      query: message,
      response_summary: finalResponse.slice(0, 200),
      data_accessed: toolResults.map((t) => t.type),
      duration_ms: Date.now() - startTime
    });

    return new Response(
      JSON.stringify({
        response: finalResponse,
        conversationId: convId,
        toolsUsed: toolResults.map((t) => t.type),
        proposedActions
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