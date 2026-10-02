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

You are also wired to the user's own always-on AI agent that runs on their
private machine. You reach it by queueing a job that the agent picks up, runs
locally, and returns. Use ask_agent to send a single task and relay the answer.
Use coordinate_agents for a task split across several sub-agents. Use list_files
to see files the agent can access, read_file to read one, and search_files to
find text across them. Summarise results for the user in plain language rather
than pasting raw JSON. If a job reports the agent is offline, tell the user their
agent machine may be switched off or the agent container is not running, and that
the request has been queued and will run once the agent is back.

You also keep the user's TASK LIST. When they ask you to remember something, note
a job, or be reminded of something to do, use add_task. Use list_tasks to show
what's outstanding (default to open tasks, soonest due first), complete_task when
they've finished something, and update_task / delete_task to change or remove an
item. When a task has a due date, convert natural phrases like "tomorrow",
"Friday", or "next week" into an ISO 8601 timestamp using the current date given
below. After changing the list, briefly confirm what you did in plain language.`;

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
    description: "Send a single task or question to the user's own always-on AI agent (runs on their private machine, backed by their local LLM). Use for anything they ask their agent to think about or do.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task or question for the agent" },
        agent_name: { type: "string", description: "Which agent persona to use; defaults to 'default'" }
      },
      required: ["task"]
    }
  },
  {
    name: "coordinate_agents",
    description: "Send a larger task for the agent to break down and work through step by step.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The overall task to coordinate" },
        agents: { type: "array", items: { type: "string" }, description: "Optional list of sub-agent names to involve" }
      },
      required: ["task"]
    }
  },
  {
    name: "list_files",
    description: "List files the user's agent can access in their files folder. Optionally within a subfolder path.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional subfolder path relative to the agent's files root" }
      }
    }
  },
  {
    name: "read_file",
    description: "Read a text file from the user's agent files folder and return its contents.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the agent's files root" }
      },
      required: ["path"]
    }
  },
  {
    name: "search_files",
    description: "Search for text across the files the user's agent can access, returning matching files and lines.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for" }
      },
      required: ["query"]
    }
  },
  {
    name: "add_task",
    description: "Add a to-do item to the user's task list. Use whenever they ask to remember, note, or be reminded of something to do.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short description of the task" },
        notes: { type: "string", description: "Optional extra detail" },
        due_at: { type: "string", description: "Optional due date/time as an ISO 8601 timestamp (e.g. 2026-10-05T09:00:00Z). Convert any relative phrasing like 'tomorrow 9am' using the current date given in the system prompt." }
      },
      required: ["title"]
    }
  },
  {
    name: "list_tasks",
    description: "List the user's tasks. Defaults to open (not-yet-done) tasks, soonest due first.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "done", "all"], description: "Which tasks to show; defaults to open" },
        due: { type: "string", enum: ["overdue", "today", "week", "any"], description: "Optional due-date filter" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "complete_task",
    description: "Mark a task as done. Identify it by a word or phrase from its title. If the phrase matches more than one open task, the tool returns the candidates so you can ask which one.",
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", description: "A word or phrase from the task's title" }
      },
      required: ["match"]
    }
  },
  {
    name: "update_task",
    description: "Change a task's title, notes, or due date. Identify it by a word or phrase from its current title.",
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", description: "A word or phrase from the task's current title" },
        title: { type: "string", description: "New title" },
        notes: { type: "string", description: "New notes" },
        due_at: { type: "string", description: "New due date/time as an ISO 8601 timestamp, or empty string to clear it" }
      },
      required: ["match"]
    }
  },
  {
    name: "delete_task",
    description: "Remove a task from the list entirely. Identify it by a word or phrase from its title.",
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", description: "A word or phrase from the task's title" }
      },
      required: ["match"]
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
      system: `${SYSTEM_PROMPT}\n\nThe current date and time is ${new Date().toISOString()} (UTC).`,
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

// Pull-model bridge to the user's always-on agent. The cloud function cannot
// reach a machine behind a home router, so instead of pushing to the agent we
// enqueue a job in `jarvis_agent_jobs`; the agent worker (running on the user's
// private machine) polls Supabase over outbound HTTPS, executes the job, and
// writes the result back. Returns { result }, { error }, or { pending } when the
// agent didn't answer in the wait window.
const runAgentJob = async (
  supabase: ReturnType<typeof createSupabaseClient>,
  op: string,
  params: Record<string, unknown>,
  userId: string,
  conversationId: string | undefined,
) => {
  // Enqueue a job the always-on agent worker (polling Supabase from the user's
  // private machine) will pick up, run locally, and write a result to. Wait a
  // short while for that result; if the agent is offline the job stays queued.
  const { data: job, error } = await supabase
    .from("jarvis_agent_jobs")
    .insert({ user_id: userId, conversation_id: conversationId ?? null, op, params, status: "queued" })
    .select("id")
    .single();
  if (error || !job) {
    return { error: "Could not queue the agent job." };
  }
  const deadlineMs = Date.now() + 40000; // wait up to ~40s for the agent to answer
  while (Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const { data: row } = await supabase
      .from("jarvis_agent_jobs")
      .select("status, result, error")
      .eq("id", job.id)
      .single();
    if (row?.status === "done") return { result: row.result };
    if (row?.status === "error") return { error: row.error || "The agent reported an error." };
  }
  return {
    pending: true,
    job_id: job.id,
    message:
      "The agent didn't respond in time - it may be offline or busy. The job is queued and will run when the agent is back online.",
  };
};

const executeTool = async (
  supabase: ReturnType<typeof createSupabaseClient>,
  userSupabase: ReturnType<typeof createSupabaseClient>,
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  proposals: Record<string, unknown>[],
  conversationId: string | undefined,
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
        const { data: revenue } = await userSupabase.rpc("get_revenue_summary", {
          period: input.period,
          year_num: input.year,
          month_num: input.month
        });
        result = revenue?.[0] || { total_revenue: 0, invoice_count: 0, avg_invoice_value: 0, previous_period_revenue: 0 };
        break;
      }
      case "get_outstanding_invoices": {
        const { data: invoices } = await userSupabase.rpc("get_outstanding_invoices", {
          limit_num: input.limit || 10,
          min_days: input.min_days_overdue || 0
        });
        result = invoices || [];
        break;
      }
      case "get_customer_summary": {
        const { data: customers } = await userSupabase.rpc("get_customer_summary", {
          customer_name: input.customer_name,
          limit_num: input.limit || 20,
          sort_by: input.sort_by || "revenue"
        });
        result = customers || [];
        break;
      }
      case "get_expense_summary": {
        const { data: expenses } = await userSupabase.rpc("get_expense_summary", {
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
        result = await runAgentJob(supabase, "process", { task: input.task, agent_name: input.agent_name || "default" }, userId, conversationId);
        break;
      }
      case "coordinate_agents": {
        result = await runAgentJob(supabase, "coordinate", { task: input.task, agents: input.agents || [] }, userId, conversationId);
        break;
      }
      case "list_files": {
        result = await runAgentJob(supabase, "file_list", { path: input.path || "" }, userId, conversationId);
        break;
      }
      case "read_file": {
        result = await runAgentJob(supabase, "file_read", { path: input.path }, userId, conversationId);
        break;
      }
      case "search_files": {
        result = await runAgentJob(supabase, "file_search", { query: input.query }, userId, conversationId);
        break;
      }
      case "add_task": {
        const row: Record<string, unknown> = { user_id: userId, title: input.title, status: "open" };
        if (input.notes) row.notes = input.notes;
        if (input.due_at) row.due_at = input.due_at;
        const { data: task, error } = await supabase
          .from("jarvis_tasks")
          .insert(row)
          .select("id, title, due_at")
          .single();
        result = error ? { error: "Could not add the task." } : { added: true, task };
        break;
      }
      case "list_tasks": {
        const status = (input.status as string) || "open";
        let q = supabase
          .from("jarvis_tasks")
          .select("id, title, notes, status, due_at")
          .eq("user_id", userId);
        if (status !== "all") q = q.eq("status", status);
        if (input.due && input.due !== "any") {
          const now = new Date();
          if (input.due === "overdue") {
            q = q.lt("due_at", now.toISOString());
          } else if (input.due === "today") {
            const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
            q = q.not("due_at", "is", null).lte("due_at", end.toISOString());
          } else if (input.due === "week") {
            const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            q = q.not("due_at", "is", null).lte("due_at", end.toISOString());
          }
        }
        const { data: tasks } = await q
          .order("due_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .limit((input.limit as number) || 50);
        result = { tasks: tasks || [], count: (tasks || []).length };
        break;
      }
      case "complete_task":
      case "update_task":
      case "delete_task": {
        const match = (input.match as string) || "";
        // Find candidate tasks by a phrase from the title. For completion we only
        // consider still-open tasks; for edits/removal, any of the user's tasks.
        let finder = supabase
          .from("jarvis_tasks")
          .select("id, title, status, due_at")
          .eq("user_id", userId)
          .ilike("title", `%${match}%`);
        if (toolName === "complete_task") finder = finder.eq("status", "open");
        const { data: matches } = await finder.limit(10);
        const candidates = matches || [];
        if (candidates.length === 0) {
          result = { error: `No matching task found for "${match}".` };
          break;
        }
        if (candidates.length > 1) {
          result = { ambiguous: true, candidates, message: "More than one task matches - ask the user which one." };
          break;
        }
        const target = candidates[0];
        if (toolName === "delete_task") {
          const { error } = await supabase.from("jarvis_tasks").delete().eq("id", target.id);
          result = error ? { error: "Could not delete the task." } : { deleted: true, task: target };
        } else if (toolName === "complete_task") {
          const { error } = await supabase.from("jarvis_tasks").update({ status: "done" }).eq("id", target.id);
          result = error ? { error: "Could not complete the task." } : { completed: true, task: target };
        } else {
          const changes: Record<string, unknown> = {};
          if (input.title) changes.title = input.title;
          if (input.notes !== undefined) changes.notes = input.notes;
          if (input.due_at !== undefined) changes.due_at = input.due_at === "" ? null : input.due_at;
          if (Object.keys(changes).length === 0) {
            result = { error: "Nothing to update - provide a new title, notes, or due date." };
            break;
          }
          const { data: updated, error } = await supabase
            .from("jarvis_tasks")
            .update(changes)
            .eq("id", target.id)
            .select("id, title, notes, status, due_at")
            .single();
          result = error ? { error: "Could not update the task." } : { updated: true, task: updated };
        }
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

    // A client that acts AS the signed-in user (not the service role), used for
    // the business-report RPCs so they scope to the caller's company via
    // current_company_id(). The service-role `supabase` client is still used for
    // trusted writes (message history, agent-job queue, task list).
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

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
      const result = await executeTool(supabase, userSupabase, toolCall.name, input as Record<string, unknown>, userId, proposedActions, convId);
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