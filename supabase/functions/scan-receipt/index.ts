import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScanReceiptRequest {
  image_base64: string;
  image_type: string;
}

interface ScanReceiptResponse {
  supplier: string | null;
  date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  total_inc_vat: number | null;
  vat_reclaimable: boolean;
  category: string | null;
  description: string | null;
  currency: string;
  error?: string;
}

const ALLOWED_CATEGORIES = ["fuel", "equipment", "supplies", "insurance", "other"];

function validateResponse(data: ScanReceiptResponse): ScanReceiptResponse {
  const validated: ScanReceiptResponse = {
    supplier: data.supplier,
    date: null,
    total_amount: null,
    vat_amount: null,
    total_inc_vat: null,
    vat_reclaimable: data.vat_reclaimable || false,
    category: null,
    description: data.description,
    currency: data.currency || "GBP",
  };

  // Validate date (DD/MM/YYYY format)
  if (data.date) {
    const dateParts = data.date.split("/");
    if (dateParts.length === 3) {
      const day = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10);
      const year = parseInt(dateParts[2], 10);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        validated.date = data.date;
      }
    }
  }

  // Validate amounts (must be positive numbers)
  if (typeof data.total_amount === "number" && data.total_amount >= 0) {
    validated.total_amount = Math.round(data.total_amount * 100) / 100;
  }
  if (typeof data.vat_amount === "number" && data.vat_amount >= 0) {
    validated.vat_amount = Math.round(data.vat_amount * 100) / 100;
  }
  if (typeof data.total_inc_vat === "number" && data.total_inc_vat >= 0) {
    validated.total_inc_vat = Math.round(data.total_inc_vat * 100) / 100;
  }

  // If total_inc_vat provided but not total_amount, calculate ex VAT
  if (validated.total_inc_vat && !validated.total_amount && validated.vat_amount) {
    validated.total_amount = Math.round((validated.total_inc_vat - validated.vat_amount) * 100) / 100;
  } else if (validated.total_amount && !validated.vat_amount && validated.total_inc_vat) {
    validated.vat_amount = Math.round((validated.total_inc_vat - validated.total_amount) * 100) / 100;
  }

  // Validate category
  const category = data.category?.toLowerCase();
  if (category && ALLOWED_CATEGORIES.includes(category)) {
    validated.category = category;
  }

  return validated;
}

async function callClaudeOCR(base64Image: string, imageType: string): Promise<ScanReceiptResponse> {
  const claudeApiKey = Deno.env.get("CLAUDE_API_KEY");
  if (!claudeApiKey) {
    throw new Error("Claude API key not configured");
  }

  const prompt = `You are a receipt scanner for a UK business expense tracking application.
Analyse this receipt image and extract the following information in JSON format only, with no other text:
{
  "supplier": string or null,
  "date": string (DD/MM/YYYY format) or null,
  "total_amount": number (ex VAT if shown) or null,
  "vat_amount": number or null,
  "total_inc_vat": number or null,
  "vat_reclaimable": boolean,
  "category": one of ["fuel", "equipment", "supplies", "insurance", "other"] or null,
  "description": string (brief description of what was purchased) or null,
  "currency": string (default GBP)
}
If you cannot read a field clearly, return null for that field. Never guess amounts.`;

  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageType,
              data: base64Image,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Claude API error:", response.status, errorText);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json() as { content: Array<{ type: string; text?: string }> };
  
  // Find the text content in the response
  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent?.text) {
    throw new Error("No response text from Claude");
  }

  // Parse JSON from response
  const jsonMatch = textContent.text.match(/\{[\s\S*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse JSON from Claude response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as ScanReceiptResponse;
  return validateResponse(parsed);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const { image_base64, image_type } = await req.json() as ScanReceiptRequest;

    if (!image_base64 || !image_type) {
      return new Response(
        JSON.stringify({ error: "Missing image_base64 or image_type" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate image type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!allowedTypes.includes(image_type)) {
      return new Response(
        JSON.stringify({ error: "Invalid image type" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await callClaudeOCR(image_base64, image_type);

    return new Response(JSON.stringify(result), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error scanning receipt:", error);

    const errorMessage = error.message || "Unknown error";
    
    // Map specific errors to user-friendly messages
    if (errorMessage.includes("API key")) {
      return new Response(
        JSON.stringify({ error: "Receipt scanning service not configured. Please enter manually." }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    if (errorMessage.includes("Cannot parse JSON")) {
      return new Response(
        JSON.stringify({ error: "Could not read receipt. Please fill in manually." }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Could not read receipt. Please fill in manually." }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});