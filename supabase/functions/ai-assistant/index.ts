import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Jarvis assistant — personal control plane.
//
// This function runs on the ISOLATED Jarvis Supabase project (jarvis-control-plane),
// NOT the ClearRoute production project. It deliberately has NO access to ClearRoute
// business data (customers, invoices, payments, expenses). Jarvis can: hold a chat,
// dispatch jobs to the user's always-on agent machine (local LLM + read-only file
// access) via the jarvis_agent_jobs queue, and manage a personal task list.

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";

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
  context?: { currentPage?: string };
}

interface ToolResult { content: string; tool_use_id: string; type: string; }

const SYSTEM_PROMPT = `You are Jarvis, the owner's personal AI assistant and control plane. You are a private tool, not a customer-facing product, and you do NOT have access to any ClearRoute business data (customers, invoices, payments, routes or expenses). If asked about business figures, say that lives in the separate ClearRoute app, not here.

You can:
- Dispatch work to the owner's always-on agent machine, which runs a local LLM and has read-only access to a files folder. Use ask_agent for a single task/question, coordinate_agents for a larger task to break down, and list_files / read_file / search_files to work with those files. Summarise results in plain language rather than pasting raw JSON. If a job reports the agent is offline, say the agent machine may be switched off or the worker container isn't running, and that the request is queued and will run when it's back.
- Keep the owner's personal task list. Use add_task when they want to remember or be reminded of something, list_tasks to show what's outstanding (default to open tasks, soonest due first), complete_task when done, and update_task / delete_task to change or remove an item. Convert relative dates ("tomorrow", "Friday") to an ISO 8601 timestamp using the current date given below.

Be concise. After changing the task list or dispatching a job, briefly confirm what you did.`;

const TOOLS = [
  { name: "ask_agent", description: "Send a single task or question to the owner's always-on agent machine (local LLM).",
    input_schema: { type: "object", properties: { task: { type: "string", description: "The task or question" }, agent_name: { type: "string", description: "Optional agent persona; defaults to 'default'" } }, required: ["task"] } },
  { name: "coordinate_agents", description: "Send a larger task for the agent to break down and work through step by step.",
    input_schema: { type: "object", properties: { task: { type: "string" }, agents: { type: "array", items: { type: "string" } } }, required: ["task"] } },
  { name: "list_files", description: "List files the agent can access, optionally within a subfolder.",
    input_schema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "read_file", description: "Read a text file from the agent's files folder.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "search_files", description: "Search for text across the agent's files.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "add_task", description: "Add a to-do item to the owner's task list.",
    input_schema: { type: "object", properties: { title: { type: "string" }, notes: { type: "string" }, due_at: { type: "string", description: "Optional ISO 8601 timestamp" } }, required: ["title"] } },
  { name: "list_tasks", description: "List tasks. Defaults to open, soonest due first.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["open", "done", "all"] }, due: { type: "string", enum: ["overdue", "today", "week", "any"] }, limit: { type: "number" } } } },
  { name: "complete_task", description: "Mark a task done, matched by a phrase from its title.",
    input_schema: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } },
  { name: "update_task", description: "Change a task's title, notes or due date, matched by a phrase from its title.",
    input_schema: { type: "object", properties: { match: { type: "string" }, title: { type: "string" }, notes: { type: "string" }, due_at: { type: "string" } }, required: ["match"] } },
  { name: "delete_task", description: "Remove a task, matched by a phrase from its title.",
    input_schema: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } },
];

const createSupabaseClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey, { global: { headers: { apikey: serviceKey } } });
};

const callClaude = async (messages: { role: string; content: unknown }[], tools: unknown[], startTime: number) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) return { error: "Claude API key not configured" };
  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 2048,
      system: `${SYSTEM_PROMPT}\n\nThe current date and time is ${new Date().toISOString()} (UTC).`,
      messages: messages.slice(-10), tools, tool_choice: { type: "auto" },
    }),
  });
  const duration = Date.now() - startTime;
  if (!response.ok) return { error: await response.text(), duration };
  return { ...(await response.json()), duration };
};

// Enqueue a job for the always-on agent worker (polling this project over outbound
// HTTPS from the owner's machine) and wait briefly for the result.
const runAgentJob = async (
  supabase: ReturnType<typeof createSupabaseClient>, op: string,
  params: Record<string, unknown>, userId: string, conversationId: string | undefined,
) => {
  const { data: job, error } = await supabase
    .from("jarvis_agent_jobs")
    .insert({ user_id: userId, conversation_id: conversationId ?? null, op, params, status: "queued" })
    .select("id").single();
  if (error || !job) return { error: "Could not queue the agent job." };
  const deadlineMs = Date.now() + 40000;
  while (Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const { data: row } = await supabase.from("jarvis_agent_jobs").select("status, result, error").eq("id", job.id).single();
    if (row?.status === "done") return { result: row.result };
    if (row?.status === "error") return { error: row.error || "The agent reported an error." };
  }
  return { pending: true, job_id: job.id, message: "The agent didn't respond in time - it may be offline or busy. The job is queued and will run when the agent is back online." };
};

const executeTool = async (
  supabase: ReturnType<typeof createSupabaseClient>, toolName: string,
  input: Record<string, unknown>, userId: string, conversationId: string | undefined,
) => {
  try {
    switch (toolName) {
      case "ask_agent":
        return await runAgentJob(supabase, "process", { task: input.task, agent_name: input.agent_name || "default" }, userId, conversationId);
      case "coordinate_agents":
        return await runAgentJob(supabase, "coordinate", { task: input.task, agents: input.agents || [] }, userId, conversationId);
      case "list_files":
        return await runAgentJob(supabase, "file_list", { path: input.path || "" }, userId, conversationId);
      case "read_file":
        return await runAgentJob(supabase, "file_read", { path: input.path }, userId, conversationId);
      case "search_files":
        return await runAgentJob(supabase, "file_search", { query: input.query }, userId, conversationId);
      case "add_task": {
        const row: Record<string, unknown> = { user_id: userId, title: input.title, status: "open" };
        if (input.notes) row.notes = input.notes;
        if (input.due_at) row.due_at = input.due_at;
        const { data: task, error } = await supabase.from("jarvis_tasks").insert(row).select("id, title, due_at").single();
        return error ? { error: "Could not add the task." } : { added: true, task };
      }
      case "list_tasks": {
        const status = (input.status as string) || "open";
        let q = supabase.from("jarvis_tasks").select("id, title, notes, status, due_at").eq("user_id", userId);
        if (status !== "all") q = q.eq("status", status);
        if (input.due && input.due !== "any") {
          const now = new Date();
          if (input.due === "overdue") q = q.lt("due_at", now.toISOString());
          else if (input.due === "today") { const e = new Date(now); e.setUTCHours(23,59,59,999); q = q.not("due_at","is",null).lte("due_at", e.toISOString()); }
          else if (input.due === "week") { const e = new Date(now.getTime() + 7*24*60*60*1000); q = q.not("due_at","is",null).lte("due_at", e.toISOString()); }
        }
        const { data: tasks } = await q.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).limit((input.limit as number) || 50);
        return { tasks: tasks || [], count: (tasks || []).length };
      }
      case "complete_task":
      case "update_task":
      case "delete_task": {
        const match = (input.match as string) || "";
        let finder = supabase.from("jarvis_tasks").select("id, title, status, due_at").eq("user_id", userId).ilike("title", `%${match}%`);
        if (toolName === "complete_task") finder = finder.eq("status", "open");
        const { data: matches } = await finder.limit(10);
        const candidates = matches || [];
        if (candidates.length === 0) return { error: `No matching task found for "${match}".` };
        if (candidates.length > 1) return { ambiguous: true, candidates, message: "More than one task matches - ask the user which one." };
        const target = candidates[0];
        if (toolName === "delete_task") {
          const { error } = await supabase.from("jarvis_tasks").delete().eq("id", target.id);
          return error ? { error: "Could not delete the task." } : { deleted: true, task: target };
        }
        if (toolName === "complete_task") {
          const { error } = await supabase.from("jarvis_tasks").update({ status: "done" }).eq("id", target.id);
          return error ? { error: "Could not complete the task." } : { completed: true, task: target };
        }
        const changes: Record<string, unknown> = {};
        if (input.title) changes.title = input.title;
        if (input.notes !== undefined) changes.notes = input.notes;
        if (input.due_at !== undefined) changes.due_at = input.due_at === "" ? null : input.due_at;
        if (Object.keys(changes).length === 0) return { error: "Nothing to update - provide a new title, notes, or due date." };
        const { data: updated, error } = await supabase.from("jarvis_tasks").update(changes).eq("id", target.id).select("id, title, notes, status, due_at").single();
        return error ? { error: "Could not update the task." } : { updated: true, task: updated };
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: err.message };
  }
};

serve(async (req) => {
  const CORSHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORSHeaders });

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id;

    const { message, conversationId, context } = await req.json() as AssistantRequest;
    if (!userId) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } });
    if (!message) return new Response(JSON.stringify({ error: "Message required" }), { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } });

    let convId = conversationId;
    if (!convId) {
      const { data: conv } = await supabase.from("ai_conversations").insert({ user_id: userId, title: message.slice(0, 50) }).select().single();
      if (conv) convId = conv.id;
    }

    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "user", content: message });

    const { data: history } = await supabase.from("ai_messages").select("*").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(20);
    const conversationHistory = (history || []).map((m: { role: string; content: string; tool_results: unknown }) => ({ role: m.role, content: m.tool_results ? JSON.stringify(m.tool_results) : m.content }));

    let contextMessage = "";
    if (context?.currentPage) contextMessage = `\n\nCurrent page context: ${context.currentPage}`;
    const fullMessage = message + contextMessage;

    const initialResponse = await callClaude([...conversationHistory.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: fullMessage }], TOOLS, startTime);
    if (initialResponse.error) {
      console.error("[jarvis] Claude call failed:", JSON.stringify(initialResponse.error));
      return new Response(JSON.stringify({ error: initialResponse.error }), { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } });
    }

    const toolCalls = initialResponse.content?.filter((c: { type: string }) => c.type === "tool_use") || [];
    const toolResults: ToolResult[] = [];
    for (const toolCall of toolCalls) {
      const result = await executeTool(supabase, toolCall.name, (toolCall.input || {}) as Record<string, unknown>, userId, convId);
      toolResults.push({ content: JSON.stringify(result), tool_use_id: toolCall.id, type: toolCall.name });
    }

    let finalResponse = initialResponse.content?.find((c: { type: string }) => c.type === "text")?.text || "";
    if (toolResults.length > 0) {
      const secondResponse = await callClaude([
        ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: fullMessage },
        { role: "assistant", content: initialResponse.content },
        { role: "user", content: toolResults.map((tr) => ({ type: "tool_result", tool_use_id: tr.tool_use_id, content: tr.content })) },
      ], TOOLS, startTime);
      finalResponse = secondResponse.content?.find((c: { type: string }) => c.type === "text")?.text || finalResponse;
    }

    await supabase.from("ai_messages").insert({
      conversation_id: convId, role: "assistant", content: finalResponse,
      tool_calls: toolCalls.length > 0 ? toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input })) : null,
      tool_results: toolResults.length > 0 ? toolResults : null,
    });
    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    await supabase.from("ai_query_log").insert({ user_id: userId, query: message, response_summary: finalResponse.slice(0, 200), data_accessed: toolResults.map((t) => t.type), duration_ms: Date.now() - startTime });

    return new Response(JSON.stringify({ response: finalResponse, conversationId: convId, toolsUsed: toolResults.map((t) => t.type) }), { headers: { ...CORSHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[jarvis] fatal error:", error?.message, error?.stack);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsFor(req), "Content-Type": "application/json" } });
  }
});
