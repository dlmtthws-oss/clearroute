import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SuggestRequest {
  description: string;
  supplier?: string;
  amount: number;
  vatAmount?: number;
  userId: string;
}

const CATEGORIES = {
  fuel: "Petrol, diesel, vehicle fuel",
  equipment: "Tools, machinery, cleaning equipment, water fed poles, squeegees, ladders",
  supplies: "Cleaning chemicals, cloths, disposables, uniforms",
  insurance: "Vehicle insurance, public liability, employer liability, equipment insurance",
  other: "Office, phone, professional fees, training, other"
};

const VAT_RULES = {
  fuel: true,
  equipment: true,
  supplies: true,
  insurance: false,
  entertainment: false,
  staff_meals: false,
  other: false
};

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const checkRuleMatch = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, supplier?: string, description?: string) => {
  const { data: rules } = await supabase
    .from("expense_categorisation_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("confidence", { ascending: false });

  if (!rules || rules.length === 0) return null;

  for (const rule of rules) {
    const searchIn = rule.pattern_type === "supplier" ? supplier : description;
    const target = rule.pattern_type === "supplier" ? supplier : description;
    if (searchIn && target && searchIn.toLowerCase().includes(rule.pattern.toLowerCase())) {
      return {
        category: rule.suggested_category,
        vatReclaimable: rule.suggested_vat_reclaimable,
        confidence: rule.confidence,
        source: "rule",
        reasoning: `Matched existing rule for "${rule.pattern}"`
      };
    }
  }
  return null;
};

const checkHistoricalMatch = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, supplier?: string, description?: string) => {
  const { data: expenses } = await supabase
    .from("expenses")
    .select("category, supplier, description")
    .eq("profiles_id", userId)
    .not("category", "is", null)
    .limit(100);

  if (!expenses || expenses.length < 3) return null;

  const categoryCounts: Record<string, number> = {};
  (expenses || []).forEach((e: any) => {
    const cat = e.category?.toLowerCase();
    if (cat) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const supplierExpenses = expenses.filter((e: any) => 
    supplier && e.supplier?.toLowerCase() === supplier.toLowerCase()
  );
  if (supplierExpenses.length >= 2) {
    const supplierCats: Record<string, number> = {};
    supplierExpenses.forEach((e: any) => {
      const cat = e.category?.toLowerCase();
      if (cat) supplierCats[cat] = (supplierCats[cat] || 0) + 1;
    });
    const topCat = Object.entries(supplierCats).sort((a, b) => b[1] - a[1])[0];
    if (topCat && topCat[1] >= 2) {
      return {
        category: topCat[0],
        vatReclaimable: VAT_RULES[topCat[0] as keyof typeof VAT_RULES] ?? false,
        confidence: Math.min(0.5 + topCat[1] * 0.15, 0.9),
        source: "history",
        reasoning: `Based on ${supplierExpenses.length} past expenses for this supplier`
      };
    }
  }

  return null;
};

const callClaude = async (supplier?: string, description?: string, amount?: number, vatAmount?: number) => {
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeKey) {
    return {
      category: "other",
      vatReclaimable: false,
      confidence: 0.3,
      reasoning: "AI unavailable - using default",
      suggestedDescription: description
    };
  }

  const prompt = `You are an expense categorisation assistant for a UK window cleaning business.

Categorise this expense:
- Supplier: ${supplier || 'Unknown'}
- Description: ${description || 'Unknown'}
- Amount: £${amount || '0'}
- VAT amount: £${vatAmount || '0'}

Available categories:
${Object.entries(CATEGORIES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

VAT reclaim rules (UK):
- Fuel: reclaimable if business use
- Equipment: reclaimable if business use
- Supplies: reclaimable
- Insurance: NOT reclaimable (exempt)
- Entertainment: NOT reclaimable
- Other: not reclaimable by default

Respond only with JSON:
{
  category: string,
  vat_reclaimable: boolean,
  confidence: number (0.0-1.0),
  reasoning: string (one sentence),
  suggested_description: string (cleaned version of description)
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
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return {
        category: "other",
        vatReclaimable: false,
        confidence: 0.3,
        reasoning: "AI unavailable",
        suggestedDescription: description
      };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    return JSON.parse(text);
  } catch {
    return {
      category: "other",
      vatReclaimable: false,
      confidence: 0.3,
      reasoning: "Error categorising expense",
      suggestedDescription: description
    };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabase = createSupabaseClient(req);

  try {
    const { description, supplier, amount, vatAmount, userId } = await req.json() as SuggestRequest;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID required" }),
        { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    let result = await checkRuleMatch(supabase, userId, supplier, description);
    
    if (!result) {
      result = await checkHistoricalMatch(supabase, userId, supplier, description);
    }

    if (!result || result.confidence < 0.85) {
      const aiResult = await callClaude(supplier, description, amount, vatAmount);
      
      result = {
        category: aiResult.category,
        vatReclaimable: aiResult.vat_reclaimable,
        confidence: aiResult.confidence,
        source: "ai",
        reasoning: aiResult.reasoning,
        suggestedDescription: aiResult.suggested_description
      };

      if (result.confidence > 0.80 && (supplier?.length > 2 || description?.length > 5)) {
        await supabase.from("expense_categorisation_rules").insert({
          user_id: userId,
          pattern: supplier || description.slice(0, 30),
          pattern_type: supplier ? "supplier" : "description",
          suggested_category: result.category,
          suggested_vat_reclaimable: result.vatReclaimable,
          confidence: result.confidence,
          created_by: "ai"
        });
      }
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});