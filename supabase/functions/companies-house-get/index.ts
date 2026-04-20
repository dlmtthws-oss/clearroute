import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const COMPANIES_HOUSE_API = "https://api.company-information.service.gov.uk";
const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const { companyNumber } = await req.json();

    if (!companyNumber) {
      return new Response(
        JSON.stringify({ error: "Company number required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("COMPANIES_HOUSE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Companies House API not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = `${COMPANIES_HOUSE_API}/company/${companyNumber}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${btoa(apiKey + ":")}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return new Response(
          JSON.stringify({ error: "Company not found" }),
          { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("Companies House API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to get company details" }),
        { status: response.status, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json() as {
      company_number: string;
      company_status: string;
      company_type: string;
      company_name: string;
      date_of_creation: string;
      registered_office_address: Record<string, string>;
      sic_codes: string[];
      accounts: Record<string, unknown>;
      confirmation_statement: Record<string, unknown>;
    };

    const result = {
      company_name: data.company_name,
      company_number: data.company_number,
      company_status: data.company_status,
      company_type: data.company_type,
      date_of_creation: data.date_of_creation,
      registered_office_address: {
        address_line_1: data.registered_office_address?.address_line_1 || "",
        address_line_2: data.registered_office_address?.address_line_2 || "",
        address_line_3: data.registered_office_address?.address_line_3 || "",
        locality: data.registered_office_address?.locality || "",
        region: data.registered_office_address?.region || "",
        postal_code: data.registered_office_address?.postal_code || "",
        country: data.registered_office_address?.country || "United Kingdom",
      },
      sic_codes: data.sic_codes || [],
    };

    return new Response(JSON.stringify(result), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Get company error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to get company details" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});