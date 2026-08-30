import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";

// Build CORS headers per request. Echoing the origin and the browser's
// requested headers guarantees the preflight allows exactly what the actual
// POST will send (supabase-js can add headers beyond the usual set), which a
// static allow-list can miss — causing the browser to accept the OPTIONS 200
// but then refuse to send the POST.
const corsFor = (req: Request) => ({
  "Access-Control-Allow-Origin": req.headers.get("Origin") ?? "*",
  "Access-Control-Allow-Headers":
    req.headers.get("Access-Control-Request-Headers") ??
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

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
run; it runs only after the user confirms.

You are also wired to the user's own AI agent service (a self-hosted multi-agent
system). Use ask_agent to send a single task to one of their agents and relay
its answer. Use coordinate_agents for a task that should be split across several
agents. Use list_agents and list_agent_tools to see what exists. Use create_agent
to build a new agent when the user asks for one - confirm the intended name and
role with the user first, then create it and report back. Use execute_agent_tool
to run one of the agent service's tools directly. These agent calls run
immediately and return their result; summarise the result for the user in plain
language rather than pasting raw JSON. If an agent call reports the bridge is not
configured, tell the user their agent bridge (the n8n webhook URL and shared
secret) has not been set up yet.`;

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
  },
  {
    name: "ask_agent",
    description: "Send a single task or question to the user's own AI agent service and return its answer. Use for anything the user asks their agent to think about or do that has no dangerous side effects.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task or question for the agent" },
        agent_name: { type: "string", description: "Which agent to use; defaults to 'default'" }
      },
      required: ["task"]
    }
  },
  {
    name: "coordinate_agents",
    description: "Send a task to be coordinated across several of the user's agents (multi-agent orchestration).",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The overall task to coordinate" },
        agents: { type: "array", items: { type: "string" }, description: "Optional list of agent names to involve" }
      },
      required: ["task"]
    }
  },
  {
    name: "list_agents",
    description: "List the agents available in the user's AI agent service.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "list_agent_tools",
    description: "List the tools available to the user's AI agent service.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "create_agent",
    description: "Create a new agent in the user's AI agent service. Confirm the intended name and role with the user before calling.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the new agent" },
        role: { type: "string", description: "System role / purpose of the agent" },
        tools: { type: "array", items: { type: "string" }, description: "Optional tool names to grant the agent" }
      },
      required: ["name", "role"]
    }
  },
  {
    name: "execute_agent_tool",
    description: "Directly run one of the agent service's tools with parameters.",
    input_schema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool name from list_agent_tools" },
        params: { type: "object", description: "Parameters for the tool" }
      },
      required: ["tool"]
    }
  }
];

const createSupabaseClient = (_req: Request) => {
  // Use the service role for trusted server-side reads/writes. Message
  // persistence (which powers cross-device sync) and the SECURITY DEFINER
  // report functions must not be blocked by RLS on the anon key. The platform
  // still gates this function behind JWT verification, so only authenticated
  // users reach it.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey, { global: { headers: { apikey: serviceKey } } });
};

const callClaude = async (messages: { role: string; content: unknown }[], tools: unknown[], startTime: number) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) {
    return { error: "Claude API key not configured" };
  }

  // Identity-linked API keys (keys tied to a user identity that can act across
  // multiple workspaces) require the request to name which workspace it acts
  // in via the `anthropic-workspace-id` header. Send it when configured; it is
  // harmless for plain workspace-scoped keys, so this supports both key types.
  const workspaceId = Deno.env.get("ANTHROPIC_WORKSPACE_ID");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": claudeKey,
    "anthropic-version": "2023-06-01"
  };
  if (workspaceId) {
    headers["anthropic-workspace-id"] = workspaceId;
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers,
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

// Bridge to the user's self-hosted AI agent service. The cloud edge function
// cannot reach the user's localhost, so every agent call is HMAC-signed and
// POSTed to their n8n webhook (public via a tunnel), which forwards it to the
// agent API inside their Docker network. `op` selects the agent operation; the
// n8n workflow switches on it. Returns { result } on success or { error }.
const callAgentBridge = async (op: string, payload: Record<string, unknown>, userId: string) => {
  const baseUrl = Deno.env.get("N8N_WEBHOOK_BASE_URL");
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET");
  if (!baseUrl || !secret) {
    return { error: "Agent bridge not configured. Set N8N_WEBHOOK_BASE_URL and N8N_WEBHOOK_SECRET." };
  }
  const path = Deno.env.get("JARVIS_AGENT_WEBHOOK_PATH") || "webhook/jarvis-agent";
  const url = baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
  const timestamp = Date.now().toString();
  const body = JSON.stringify({ op, ...payload, user_id: userId, requested_at: new Date().toISOString() });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + body));
  const signature = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jarvis-timestamp": timestamp,
        "x-jarvis-signature": signature,
      },
      body,
    });
    const text = await resp.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!resp.ok) return { error: `Agent bridge returned ${resp.status}`, detail: parsed };
    return { result: parsed };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
      case "ask_agent": {
        result = await callAgentBridge("process", { task: input.task, agent_name: input.agent_name || "default" }, userId);
        break;
      }
      case "coordinate_agents": {
        result = await callAgentBridge("coordinate", { task: input.task, agents: input.agents || [] }, userId);
        break;
      }
      case "list_agents": {
        result = await callAgentBridge("list_agents", {}, userId);
        break;
      }
      case "list_agent_tools": {
        result = await callAgentBridge("list_tools", {}, userId);
        break;
      }
      case "create_agent": {
        result = await callAgentBridge("create_agent", { name: input.name, role: input.role, tools: input.tools || [] }, userId);
        break;
      }
      case "execute_agent_tool": {
        result = await callAgentBridge("execute_tool", { tool: input.tool, params: input.params || {} }, userId);
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
  const CORSHeaders = corsFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const startTime = Date.now();
  const supabase = createSupabaseClient(req);

  try {
    // Authenticate the caller from their JWT. The gateway no longer enforces
    // this (verify_jwt is off so the browser's request and CORS preflight are
    // never rejected before reaching us), so the function verifies the token
    // itself and derives the user id from it rather than trusting the body.
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id;

    const { message, conversationId, context } = await req.json() as AssistantRequest;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!message) {
      return new Response(
        JSON.stringify({ error: "Message required" }),
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
      console.error("[ai-assistant] Claude call failed:", JSON.stringify(initialResponse.error));
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
      // Feed the tool results back using the Anthropic content-block format:
      // the assistant turn carries the original content (text + tool_use
      // blocks), and the following user turn carries matching tool_result
      // blocks keyed by tool_use_id.
      const secondResponse = await callClaude(
        [
          ...conversationHistory.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          { role: "user", content: fullMessage },
          { role: "assistant", content: initialResponse.content },
          {
            role: "user",
            content: toolResults.map((tr) => ({
              type: "tool_result",
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          },
        ],
        TOOLS,
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
    console.error("[ai-assistant] fatal error:", error?.message, error?.stack);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsFor(req), "Content-Type": "application/json" } }
    );
  }
});