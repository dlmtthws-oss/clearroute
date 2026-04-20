import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Simple in-memory rate limiting (in production use Redis or database)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 60
const RATE_WINDOW = 60 * 60 * 1000 // 1 hour

function checkRateLimit(token: string): boolean {
  const now = Date.now()
  const record = rateLimitStore.get(token)
  
  if (!record || now > record.resetTime) {
    rateLimitStore.set(token, { count: 1, resetTime: now + RATE_WINDOW })
    return true
  }
  
  if (record.count >= RATE_LIMIT) {
    return false
  }
  
  record.count++
  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Configuration missing' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { portal_token } = await req.json()

    if (!portal_token) {
      return new Response(
        JSON.stringify({ error: 'Missing portal token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check rate limit
    if (!checkRateLimit(portal_token)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Get customer by portal token
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, address_line_1, address_line_2, city, postcode, email, phone, service_type, portal_enabled, portal_token')
      .eq('portal_token', portal_token)
      .single()

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: 'Invalid portal link' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!customer.portal_enabled) {
      return new Response(
        JSON.stringify({ error: 'Portal access is disabled' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get company settings for branding
    const { data: company } = await supabase
      .from('company_settings')
      .select('company_name, company_email, company_phone, address_line_1, city, postcode, primary_color')
      .limit(1)
      .single()

    // Get customer's invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, issue_date, due_date, total, status, subtotal, vat_amount')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })

    // Get customer's upcoming route stops
    const today = new Date().toISOString().split('T')[0]
    const { data: routeStops } = await supabase
      .from('route_stops')
      .select('id, scheduled_date, estimated_duration, routes(name, scheduled_date), customers(name, service_type)')
      .eq('customer_id', customer.id)
      .gte('scheduled_date', today)
      .order('scheduled_date', { ascending: true })
      .limit(5)

    // Get GoCardless mandate status
    const { data: mandate } = await supabase
      .from('gocardless_mandates')
      .select('id, gc_mandate_id, status, reference')
      .eq('customer_id', customer.id)
      .in('status', ['active', 'pending', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Return sanitised data
    return new Response(
      JSON.stringify({
        customer: {
          name: customer.name,
          address_line_1: customer.address_line_1,
          address_line_2: customer.address_line_2,
          city: customer.city,
          postcode: customer.postcode,
          service_type: customer.service_type,
          email: customer.email,
          phone: customer.phone,
        },
        company: company || {
          company_name: 'ClearRoute',
          company_email: '',
          company_phone: '',
          primary_color: '#3B82F6'
        },
        invoices: (invoices || []).map(inv => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          total: inv.total,
          subtotal: inv.subtotal,
          vat_amount: inv.vat_amount,
          status: inv.status,
          is_overdue: inv.status !== 'paid' && inv.due_date && new Date(inv.due_date) < new Date(),
        })),
        upcoming_visits: (routeStops || []).map(stop => ({
          id: stop.id,
          scheduled_date: stop.scheduled_date,
          estimated_duration: stop.estimated_duration,
          route_name: stop.routes?.name,
          service_type: stop.customers?.service_type,
        })),
        mandate: mandate ? {
          id: mandate.id,
          status: mandate.status,
          reference: mandate.reference,
        } : null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Portal error:', error)
    return new Response(
      JSON.stringify({ error: 'An error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})