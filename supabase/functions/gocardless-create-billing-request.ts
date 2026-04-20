import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOCARDLESS_ACCESS_TOKEN = Deno.env.get('GOCARDLESS_ACCESS_TOKEN')!
const GOCARDLESS_ENVIRONMENT = Deno.env.get('GOCARDLESS_ENVIRONMENT') || 'sandbox'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const goCardlessApi = GOCARDLESS_ENVIRONMENT === 'live' 
  ? 'https://api.gocardless.com'
  : 'https://api-sandbox.gocardless.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type, X-GoCardless-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { customer_id, customer_name, email, address_line_1, city, postcode } = await req.json()

    if (!customer_id || !customer_name || !email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create a billing request via GoCardless API
    const billingRequestResponse = await fetch(`${goCardlessApi}/billing_requests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GOCARDLESS_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'GoCardless-Version': '2015-01-01',
      },
      body: JSON.stringify({
        billing_request: {
          customer: {
            email,
            given_name: customer_name.split(' ')[0],
            family_name: customer_name.split(' ').slice(1).join(' ') || '',
            address_line_1: address_line_1 || '',
            city: city || '',
            postal_code: postcode || '',
            country_code: 'GB',
          },
          mandate: {
            scheme: 'dd',
          },
          currency: 'GBP',
        },
      }),
    })

    const billingRequestData = await billingRequestResponse.json()

    if (billingRequestData.error) {
      return new Response(
        JSON.stringify({ error: billingRequestData.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const billingRequest = billingRequestData.billing_requests[0]

    // Create billing request flow for hosted page
    const flowResponse = await fetch(`${goCardlessApi}/billing_request_flows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GOCARDLESS_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'GoCardless-Version': '2015-01-01',
      },
      body: JSON.stringify({
        billing_request_flows: {
          billing_request: billingRequest.links.billing_request,
          redirect_uri: `${req.headers.get('origin') || 'http://localhost:3000'}/gocardless/callback`,
        },
      }),
    })

    const flowData = await flowResponse.json()
    const flow = flowData.billing_request_flows[0]

    // Save mandate to database
    const { data: mandate, error: mandateError } = await supabase
      .from('gocardless_mandates')
      .insert({
        customer_id,
        gc_mandate_id: billingRequest.links.mandate,
        gc_customer_id: billingRequest.links.customer,
        status: 'pending',
        reference: flow.redirect_url?.split('=').pop() || '',
      })
      .select()
      .single()

    if (mandateError) {
      return new Response(
        JSON.stringify({ error: mandateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update customer with mandate reference
    await supabase
      .from('customers')
      .update({ 
        gc_mandate_id: mandate.id,
        payment_method: 'direct_debit'
      })
      .eq('id', customer_id)

    return new Response(
      JSON.stringify({
        success: true,
        hosted_url: flow.redirect_url,
        mandate_id: mandate.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})