import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncCustomerRequest {
  customerId: string;
  userId: string;
}

interface XeroContact {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
  PhoneNumber?: string;
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  AddressLine4?: string;
  City?: string;
  Region?: string;
  PostalCode?: string;
  Country?: string;
  TaxNumber?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "Xero not configured" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

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
      .from("xero_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (fetchError || !connection) {
      return new Response(
        JSON.stringify({ error: "No active Xero connection" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenExpiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    let accessToken = connection.access_token;
    if (tokenExpiresAt <= fiveMinutesFromNow) {
      const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/xero-refresh-token`, {
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
        .from("xero_connections")
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

    const addresses: any[] = [];
    if (customer.address) {
      addresses.push({
        AddressType: "STREET",
        AddressLine1: customer.address,
        AddressLine2: customer.address_line_2 || "",
        City: customer.city || "",
        Region: customer.county || "",
        PostalCode: customer.postcode || "",
        Country: "United Kingdom",
      });
    }

    if (customer.postal_address && customer.postal_address !== customer.address) {
      addresses.push({
        AddressType: "POSTALBOX",
        AddressLine1: customer.postal_address,
        AddressLine2: customer.postal_address_line_2 || "",
        City: customer.postal_city || "",
        Region: customer.postal_county || "",
        PostalCode: customer.postal_postcode || "",
        Country: "United Kingdom",
      });
    }

    const xeroContact: XeroContact = {
      ContactID: customer.xero_contact_id || "",
      Name: customer.name,
      EmailAddress: customer.email,
      PhoneNumber: customer.phone,
      TaxNumber: customer.vat_number || "",
    };

    if (addresses.length > 0) {
      xeroContact.AddressType = addresses[0].AddressType;
      xeroContact.AddressLine1 = addresses[0].AddressLine1;
      xeroContact.AddressLine2 = addresses[0].AddressLine2;
      xeroContact.City = addresses[0].City;
      xeroContact.Region = addresses[0].Region;
      xeroContact.PostalCode = addresses[0].PostalCode;
      xeroContact.Country = addresses[0].Country;
    }

    const method = customer.xero_contact_id ? "PUT" : "POST";
    const endpoint = customer.xero_contact_id 
      ? `${XERO_API_URL}/Contacts/${customer.xero_contact_id}`
      : `${XERO_API_URL}/Contacts`;

    const apiResponse = await fetch(endpoint, {
      method: method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": connection.tenant_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Contacts: [xeroContact] }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Xero API error:", errorText);
      
      await supabase.from("xero_sync_log").insert({
        user_id: userId,
        entity_type: "customer",
        entity_id: customerId,
        direction: "to_xero",
        status: "error",
        error_message: errorText,
      });

      return new Response(
        JSON.stringify({ error: "Failed to sync customer to Xero", details: errorText }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseData = await apiResponse.json();
    const createdContact = responseData?.Contacts?.[0];
    
    if (!createdContact?.ContactID) {
      return new Response(
        JSON.stringify({ error: "Invalid response from Xero" }),
        { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("customers")
      .update({
        xero_contact_id: createdContact.ContactID,
        xero_synced_at: new Date().toISOString(),
      })
      .eq("id", customerId);

    await supabase.from("xero_sync_log").insert({
      user_id: userId,
      entity_type: "customer",
      entity_id: customerId,
      direction: "to_xero",
      status: "success",
      xero_id: createdContact.ContactID,
    });

    return new Response(JSON.stringify({
      success: true,
      xero_contact_id: createdContact.ContactID,
      synced_at: new Date().toISOString(),
    }), {
      headers: { ...CORSHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error syncing customer to Xero:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});