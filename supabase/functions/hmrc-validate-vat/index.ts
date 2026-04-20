import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const HMRC_API = "https://api.service.hmrc.gov.uk";
const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function normalizeVATNumber(input: string): string {
  return input
    .toUpperCase()
    .replace(/GB/g, "")
    .replace(/\s/g, "")
    .replace(/-/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { vatNumber, useCache = true } = await req.json();

    if (!vatNumber) {
      return new Response(
        JSON.stringify({ error: "VAT number required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedVAT = normalizeVATNumber(vatNumber);

    // Validate format (9 or 12 digits)
    if (!/^\d{9}$|^\d{12}$/.test(normalizedVAT)) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid VAT number format" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check cache first
    if (useCache) {
      const { data: cached } = await supabase
        .from("vat_validation_cache")
        .select("*")
        .eq("vat_number", normalizedVAT)
        .single();

      if (cached && new Date(cached.validated_at).getTime() > Date.now() - CACHE_TTL) {
        return new Response(
          JSON.stringify({
            valid: cached.is_valid,
            company_name: cached.company_name,
            address: cached.address,
            cached: true,
            validated_at: cached.validated_at,
          }),
          { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Call HMRC API
    const url = `${HMRC_API}/organisations/vat/check-vat-number/lookup/${normalizedVAT}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    let result = {
      valid: null as boolean | null,
      company_name: null as string | null,
      address: null as string | null,
      error: null as string | null,
    };

    if (response.ok) {
      const data = await response.json() as {
        target: string;
        vat_number: string;
        name: string;
        address: string;
        valid: boolean;
      };

      result = {
        valid: data.valid,
        company_name: data.name || null,
        address: data.address || null,
      };

      // Cache the result
      await supabase.from("vat_validation_cache").upsert({
        vat_number: normalizedVAT,
        is_valid: data.valid,
        company_name: data.name || null,
        address: data.address || null,
        validated_at: new Date().toISOString(),
      });
    } else if (response.status === 404) {
      result = { valid: false, error: null };
    } else {
      result = {
        valid: null,
        error: "Could not verify at this time",
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("VAT validation error:", error);
    return new Response(
      JSON.stringify({ valid: null, error: "Validation failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});