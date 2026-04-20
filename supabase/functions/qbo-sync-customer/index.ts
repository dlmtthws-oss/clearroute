import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncCustomerRequest {
  customerId: string;
  userId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const environment = Deno.env.get("QBO_ENVIRONMENT") || "sandbox";
    const baseUrl = environment === "sandbox" 
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    const { customerId, userId } = await req.json() as SyncCustomerRequest;
    if (!customerId || !userId) {
      return new Response(
        JSON.stringify({ error: "Customer ID and User ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: connection, error: fetchError } = await supabase
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (fetchError || !connection) {
      return new Response(
        JSON.stringify({ error: "No active QuickBooks connection" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenExpiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    let accessToken = connection.access_token;
    if (tokenExpiresAt <= fiveMinutesFromNow) {
      const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/qbo-refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ userId }),
      });

      if (!refreshResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to refresh token" }),
          { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: refreshed } = await supabase
        .from("quickbooks_connections")
        .select("access_token")
        .eq("user_id", userId)
        .single();
      
      if (refreshed) {
        accessToken = refreshed.access_token;
      }
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .single();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const qboCustomer: any = {
      DisplayName: customer.name,
    };

    if (customer.email) {
      qboCustomer.PrimaryEmailAddr = { Address: customer.email };
    }

    if (customer.phone) {
      qboCustomer.PrimaryPhone = { FreeFormNumber: customer.phone };
    }

    if (customer.address || customer.postcode) {
      qboCustomer.BillAddr = {
        Line1: customer.address || "",
        City: customer.city || "",
        CountrySubDivisionCode: customer.county || "",
        PostalCode: customer.postcode || "",
        Country: "UK",
      };
    }

    if (customer.is_business && customer.company_number) {
      qboCustomer.CompanyName = customer.company_number;
    }

    if (customer.vat_number) {
      qboCustomer.TaxIdentifier = customer.vat_number;
    }

    const method = customer.qbo_customer_id ? "POST" : "POST";
    const endpoint = customer.qbo_customer_id 
      ? `${baseUrl}/v3/company/${connection.realm_id}/customer?minorversion=65&method=update`
      : `${baseUrl}/v3/company/${connection.realm_id}/customer?minorversion=65`;

    const requestBody = customer.qbo_customer_id 
      ? { ...qboCustomer, Id: customer.qbo_customer_id }
      : qboCustomer;

    const apiResponse = await fetch(endpoint, {
      method: method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("QuickBooks API error:", errorText);
      
      await supabase.from("quickbooks_sync_log").insert({
        user_id: userId,
        entity_type: "customer",
        entity_id: customerId,
        direction: "to_qbo",
        status: "error",
        error_message: errorText,
      });

      return new Response(
        JSON.stringify({ error: "Failed to sync customer to QuickBooks", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdCustomer = responseData.Customer;
    
    if (!createdCustomer?.Id) {
      return new Response(
        JSON.stringify({ error: "Invalid response from QuickBooks" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("customers")
      .update({
        qbo_customer_id: createdCustomer.Id,
        qbo_synced_at: new Date().toISOString(),
      })
      .eq("id", customerId);

    await supabase.from("quickbooks_sync_log").insert({
      user_id: userId,
      entity_type: "customer",
      entity_id: customerId,
      direction: "to_qbo",
      status: "success",
      qbo_id: createdCustomer.Id,
    });

    return new Response(JSON.stringify({
      success: true,
      qbo_customer_id: createdCustomer.Id,
      synced_at: new Date().toISOString(),
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing customer to QuickBooks:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});