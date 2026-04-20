import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UK_PRICING = {
  london: { residential: { min: 15, max: 25 }, commercial: { min: 35, max: 80 } },
  south_east: { residential: { min: 12, max: 18 }, commercial: { min: 25, max: 60 } },
  midlands: { residential: { min: 8, max: 13 }, commercial: { min: 20, max: 45 } },
  north_west: { residential: { min: 8, max: 12 }, commercial: { min: 18, max: 40 } },
  north_east: { residential: { min: 7, max: 11 }, commercial: { min: 16, max: 38 } },
  scotland: { residential: { min: 8, max: 12 }, commercial: { min: 18, max: 42 } },
  wales: { residential: { min: 7, max: 11 }, commercial: { min: 15, max: 35 } },
  default: { residential: { min: 8, max: 12 }, commercial: { min: 18, max: 40 } }
};

const getRegionFromPostcode = (postcode: string): string => {
  const prefix = postcode?.toUpperCase().slice(0, 2);
  const londonCodes = ['E', 'SE', 'SW', 'W', 'NW', 'NE', 'WC', 'EC', 'N', 'S', 'SW', 'EC'];
  if (prefix?.startsWith('M')) return 'north_west';
  if (prefix?.startsWith('SK') || prefix?.startsWith('OL')) return 'north_west';
  if (prefix?.startsWith('CF') || prefix?.startsWith('NP')) return 'wales';
  if (prefix?.startsWith('NE')) return 'north_east';
  if (prefix?.startsWith('RG') || prefix?.startsWith('GU')) return 'south_east';
  if (londonCodes.some(c => prefix?.startsWith(c))) return 'london';
  return 'default';
};

const createSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseKey, { global: { headers: { apikey: supabaseKey } } });
};

const calculateSetupScore = async (supabase: ReturnType<typeof createSupabaseClient>, userId: string, customers: any[], routes: any[], invoices: any[], gocardless: any, recurring: any) => {
  let score = 0;
  const progress: any = {};

  const { data: companySettings } = await supabase.from("company_settings").select("company_name, address_line_1").eq("profiles_id", userId).single();
  progress.company_details_complete = !!companySettings?.company_name;
  if (progress.company_details_complete) score += 10;

  progress.logo_uploaded = companySettings?.logo_url?.length > 0;
  if (progress.logo_uploaded) score += 5;

  progress.first_customer_added = customers.length > 0;
  if (progress.first_customer_added) score += 10;

  progress.first_route_created = routes.length > 0;
  if (progress.first_route_created) score += 10;

  progress.gocardless_connected = !!gocardless;
  if (progress.gocardless_connected) score += 20;

  const sentInvoices = invoices.filter((i: any) => i.status === 'sent' || i.status === 'paid');
  progress.first_invoice_sent = sentInvoices.length > 0;
  if (progress.first_invoice_sent) score += 10;

  progress.recurring_invoice_set_up = recurring?.length > 0;
  if (progress.recurring_invoice_set_up) score += 15;

  progress.team_member_added = false;
  progress.first_payment_collected = invoices.some((i: any) => i.status === 'paid');
  if (progress.first_payment_collected) score += 10;

  await supabase.from("setup_score").upsert({
    user_id: userId,
    ...progress,
    score,
    updated_at: new Date().toISOString()
  });

  return { score, progress };
};

const generateInsights = async (userId: string, customers: any[], routes: any[], invoices: any[], gocardless: any, recurring: any[], companySettings: any) => {
  const customerCount = customers.length;
  const routeCount = routes.length;
  const paidAmount = invoices.filter((i: any) => i.status === 'paid').reduce((sum: number, i: any) => sum + Number(i.total || 0), 0);
  const totalAmount = invoices.reduce((sum: number, i: any) => sum + Number(i.total || 0), 0);
  const avgInvoiceValue = customerCount > 0 ? totalAmount / customerCount : 0;
  const hasGocardless = !!gocardless;
  const hasRecurring = recurring?.length > 0;
  const workerCount = routes.filter((r: any) => r.worker_id).length;

  const postcodes = customers.map((c: any) => c.postcode).filter(Boolean);
  const region = postcodes.length > 0 ? getRegionFromPostcode(postcodes[0]) : 'default';
  const regionalPricing = UK_PRICING[region] || UK_PRICING.default;

  const insights: any[] = [];

  if (avgInvoiceValue < regionalPricing.residential.min) {
    insights.push({
      insight_type: "pricing_suggestion",
      title: "Your pricing appears below market rate",
      content: `Based on customers in ${region === 'default' ? 'your area' : region}, typical window cleaning rates are £${regionalPricing.residential.min}-£${regionalPricing.residential.max} per property. Your average invoice value is £${avgInvoiceValue.toFixed(2)}. A small price increase could significantly improve margins.`,
      action_label: "Review Pricing",
      action_url: "/settings/pricing",
      priority: 1
    });
  }

  const postcodeGroups = customers.reduce((acc: any, c: any) => {
    if (c.postcode) {
      const area = c.postcode.slice(0, 2);
      acc[area] = (acc[area] || 0) + 1;
    }
    return acc;
  }, {});

  const clusters = Object.entries(postcodeGroups).filter(([, count]) => (count as number) > 1);
  if (clusters.length >= 2) {
    insights.push({
      insight_type: "route_recommendation",
      title: "Your customers form natural clusters",
      content: `Your customers are spread across ${clusters.length} postcode areas. Consider creating separate routes for each cluster to reduce drive time between visits. ${clusters.map(([area, count]) => `${area} (${count} customers)`).join(', ')}.`,
      action_label: "View Routes",
      action_url: "/routes",
      priority: 2
    });
  }

  if (!hasGocardless && customerCount > 3) {
    insights.push({
      insight_type: "efficiency_suggestion",
      title: "Direct debit setup could save time",
      content: `${customerCount - (gocardless ? 1 : 0)} customers are on manual payment. Setting up GoCardless direct debit would automate payments and save approximately 2 hours per month chasing payments. Average collection improves 14 days with direct debit.`,
      action_label: "Set Up Direct Debit",
      action_url: "/settings/gocardless",
      priority: 3
    });
  }

  if (!hasRecurring && customerCount > 2) {
    const repeatCustomers = invoices.filter((i: any) => invoices.some((i2: any) => i2.customer_id === i.customer_id && i2.id !== i.id)).length;
    if (repeatCustomers > 0) {
      insights.push({
        insight_type: "quick_win",
        title: "Set up recurring invoices",
        content: `${repeatCustomers} of your customers have been invoiced more than once. Setting up recurring invoices would automate billing and ensure consistent cash flow.`,
        action_label: "Set Up Recurring",
        action_url: "/invoices/recurring",
        priority: 4
      });
    }
  }

  if (customerCount < 5 && routes.length > 0) {
    insights.push({
      insight_type: "setup_tip",
      title: "Import existing customers",
      content: `You have ${customerCount} customers and ${routes.length} route(s). Import your existing customer list from a CSV to get a complete view and enable route planning with all customers.`,
      action_label: "Import Customers",
      action_url: "/customers/import",
      priority: 5
    });
  }

  if (routes.length > 0 && routeCount < 2) {
    insights.push({
      insight_type: "route_recommendation",
      title: "Consider multiple route days",
      content: `You have ${customerCount} customers but only ${routeCount} route(s). Spreading customers across multiple days can improve service quality and reduce daily route length.`,
      action_label: "Create Another Route",
      action_url: "/routes/new",
      priority: 6
    });
  }

  return insights.slice(0, 6);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createSupabaseClient(req);
  const userId = req.headers.get("x-user-id");

  if (!userId) {
    return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { data: customers } = await supabase.from("customers").select("id, name, postcode").eq("profiles_id", userId);
    const { data: routes } = await supabase.from("routes").select("id, name").eq("profiles_id", userId);
    const { data: invoices } = await supabase.from("invoices").select("id, customer_id, total, status").eq("profiles_id", userId);
    const { data: gocardless } = await supabase.from("gocardless_connections").select("id").eq("user_id", userId).single();
    const { data: recurring } = await supabase.from("recurring_invoices").select("id").eq("user_id", userId);
    const { data: companySettings } = await supabase.from("company_settings").select("company_name, logo_url, address_line_1").eq("profiles_id", userId).single();

    const insights = await generateInsights(userId, customers || [], routes || [], invoices || [], gocardless, recurring || [], companySettings);

    const { data: setup } = await calculateSetupScore(supabase, userId, customers || [], routes || [], invoices || [], gocardless, recurring || []);

    await supabase.from("onboarding_insights").delete().eq("user_id", userId).eq("is_dismissed", false);
    if (insights.length > 0) {
      await supabase.from("onboarding_insights").insert(
        insights.map((insight, i) => ({
          user_id: userId,
          ...insight,
          priority: insight.priority || (10 - i * 2)
        }))
      );
    }

    return new Response(JSON.stringify({ insights, setupScore: setup?.score || 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});