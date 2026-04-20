import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const COMPANIES_HOUSE_API = "https://api.company-information.service.gov.uk";
const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface SearchRequest {
  query: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const { query } = await req.json() as SearchRequest;

    if (!query || query.length < 2) {
      return new Response(
        JSON.stringify({ error: "Query must be at least 2 characters" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check cache
    const cacheKey = `search:${query.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...CORSHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("COMPANIES_HOUSE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Companies House API not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(`${COMPANIES_HOUSE_API}/search/companies`);
    url.searchParams.set("q", query);
    url.searchParams.set("items_per_page", "5");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${btoa(apiKey + ":")}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Companies House API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to search companies" }),
        { status: response.status, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json() as {
      items: Array<{
        company_number: string;
        company_status: string;
        company_type: string;
        title: string;
        address: Record<string, string>;
        date_of_creation: string;
      }>;
    };

    // Filter to active companies only
    const results = (data.items || [])
      .filter((company) => company.company_status === "active")
      .map((company) => ({
        company_name: company.title,
        company_number: company.company_number,
        company_status: company.company_status,
        company_type: company.company_type,
        date_of_creation: company.date_of_creation,
        registered_office_address: {
          address_line_1: company.address?.address_line_1 || "",
          address_line_2: company.address?.address_line_2 || "",
          locality: company.address?.locality || "",
          region: company.address?.region || "",
          postal_code: company.address?.postal_code || "",
          country: company.address?.country || "United Kingdom",
        },
      }));

    const responseData = { results };

    // Cache the results
    cache.set(cacheKey, { data: responseData, expiry: Date.now() + CACHE_TTL });

    return new Response(JSON.stringify(responseData), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Search error:", error);
    return new Response(
      JSON.stringify({ error: "Search failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});