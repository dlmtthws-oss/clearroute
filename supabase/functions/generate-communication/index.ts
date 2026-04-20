import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  customerId: string;
  communicationType: string;
  triggerData?: Record<string, unknown>;
  channel?: string;
}

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const PROMPTS: Record<string, string> = {
  appointment_confirmation: `Write a friendly, professional appointment confirmation {channel} for a UK window cleaning business.

Customer: {customer_name}
Service date: {service_date}
Time: {service_time}
Services: {services}
Duration: {duration} minutes
Worker: {worker_name}

Requirements:
- Warm but professional tone
- British English spelling
- Include all key details naturally
- End with: {company_phone}
- SMS max 160 characters
- Do not use exclamation marks more than once
- Do not use word 'bespoke'

Respond in JSON: { subject: string|null, body: string }`,

  payment_reminder_soft: `Write a gentle, friendly payment reminder {channel} for a UK window cleaning business.

Customer: {customer_name}
Invoice: {invoice_number}
Amount: £{amount}
Due date: {due_date}
Days overdue: {days_overdue}
Payment history: {payment_history}

Requirements:
- Assume it's an oversight
- Friendly and non-confrontational
- Offer help if there's an issue
- Include payment link: {payment_link}
- British English
- Professional but human

Respond in JSON: { subject: string|null, body: string }`,

  payment_reminder_firm: `Write a firm but professional payment reminder {channel} for a UK window cleaning business.
This is a {reminder_count} reminder.

Invoice: {invoice_number}
Amount: £{amount}
Customer: {customer_name}

Requirements:
- Clear but not aggressive
- Reference previous reminders
- Mention possible consequences matter-of-factly
- Give clear payment deadline
- British English

Respond in JSON: { subject: string|null, body: string }`,

  job_completion: `Write a brief, warm follow-up message sent after completing a window cleaning job.

Customer: {customer_name}
Job completed: {completion_date}
Services performed: {services}
Worker: {worker_name}
Next scheduled: {next_visit}

Requirements:
- Thank them for their custom
- Mention work done briefly
- If next visit known: mention it
- Invite concerns if any
- Short courtesy message
- Do not mention payment

Respond in JSON: { subject: string|null, body: string }`,

  satisfaction_follow_up: `Write a satisfaction check-in message for a customer who was visited recently.

Customer: {customer_name}
Visit date: {visit_date}
Services: {services}

Requirements:
- Ask for feedback lightly
- Mention how to raise concerns
- Keep it warm and short
- NOT demanding or pushy

Respond in JSON: { subject: string|null, body: string }`,

  re_engagement: `Write a re-engagement message for a customer who hasn't been visited.

Customer: {customer_name}
Last visit: {last_visit_date}
Usual frequency: {usual_frequency}
Services: {usual_services}
Current month: {current_month}

Requirements:
- Acknowledge it's been a while naturally
- Don't make them feel guilty
- Offer to rebook
- Keep it personal and warm

Respond in JSON: { subject: string|null, body: string }`
};

const generatePrompt = (type: string, data: Record<string, unknown>, channel: string) => {
  let prompt = PROMPTS[type] || PROMPTS.appointment_confirmation;
  
  const replacements: Record<string, string> = {
    channel: channel === 'sms' ? 'SMS (max 160 characters)' : 'email',
    customer_name: data.customerName || 'Customer',
    service_date: data.serviceDate || 'TBC',
    service_time: data.serviceTime || 'TBC',
    services: data.services || 'Window cleaning',
    duration: data.duration || '60',
    worker_name: data.workerName || 'Our team',
    invoice_number: data.invoiceNumber || 'N/A',
    amount: data.amount || '0',
    due_date: data.dueDate || 'TBC',
    days_overdue: String(data.daysOverdue || 0),
    payment_history: data.paymentHistory || 'Usually pays on time',
    payment_link: data.paymentLink || 'Visit your customer portal',
    reminder_count: data.reminderCount || 'second',
    completion_date: data.completionDate || 'recently',
    visit_date: data.visitDate || 'recently',
    next_visit: data.nextVisit || 'to be confirmed',
    last_visit_date: data.lastVisitDate || 'a while ago',
    usual_frequency: data.usualFrequency || 'regular',
    usual_services: data.usualServices || 'window cleaning',
    current_month: data.currentMonth || new Date().toLocaleDateString('en-GB', { month: 'long' }),
    company_phone: data.companyPhone || 'Call us on 01234 567890'
  };

  Object.entries(replacements).forEach(([key, value]) => {
    prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), value);
  });

  return prompt;
};

const callClaude = async (prompt: string) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) {
    return { subject: null, body: "Communication service unavailable" };
  }

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
        system: "You are a UK business communications specialist. Respond only with valid JSON.",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return { subject: null, body: "Failed to generate message" };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    return JSON.parse(text);
  } catch {
    return { subject: null, body: "Error generating message" };
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
    const { customerId, communicationType, triggerData, channel = "email" } = await req.json() as GenerateRequest;

    if (!customerId || !communicationType) {
      return new Response(
        JSON.stringify({ error: "Customer ID and communication type required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("name, email, phone, profiles_id")
      .eq("id", customerId)
      .single();

    if (!customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: prefs } = await supabase
      .from("communication_preferences")
      .select("*")
      .eq("customer_id", customerId)
      .single();

    if (prefs?.unsubscribed_at) {
      return new Response(
        JSON.stringify({ error: "Customer has unsubscribed" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: autoSettings } = await supabase
      .from("communication_automation")
      .select("*")
      .eq("user_id", userId)
      .single();

    const { data: companySettings } = await supabase
      .from("company_settings")
      .select("company_name, phone")
      .eq("profiles_id", userId)
      .single();

    const mergeData = {
      ...triggerData,
      customerName: customer.name,
      companyPhone: companySettings?.phone || '01234 567890'
    };

    const prompt = generatePrompt(communicationType, mergeData, channel);
    const generated = await callClaude(prompt);

    if (!generated.body) {
      return new Response(
        JSON.stringify({ error: "Failed to generate message" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const needsApproval = ['payment_reminder_soft', 'payment_reminder_firm', 're_engagement'].includes(communicationType);
    const autoApproved = autoSettings?.[`${communicationType}_auto`] ?? false;

    const queueItem = {
      user_id: userId,
      customer_id: customerId,
      communication_type: communicationType,
      channel,
      status: needsApproval && !autoApproved ? 'ready' : 'approved',
      generated_subject: generated.subject,
      generated_body: generated.body,
      trigger_data: mergeData,
      approved_at: autoApproved || !needsApproval ? new Date().toISOString() : null,
      approved_by: autoApproved || !needsApproval ? userId : null
    };

    const { data: queued, error: queueError } = await supabase
      .from("communication_queue")
      .insert(queueItem)
      .select()
      .single();

    if (queueError) throw queueError;

    return new Response(
      JSON.stringify({
        success: true,
        communication: queued,
        preview: generated
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