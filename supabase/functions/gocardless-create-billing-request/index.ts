import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const GOCARDLESS_ACCESS_TOKEN = Deno.env.get('GOCARDLESS_ACCESS_TOKEN')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  
  if (!GOCARDLESS_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Missing environment configuration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { customer_id, customer_name, email, address_line_1, city, postcode } = await req.json()

    if (!customer_id || !customer_name || !email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: customer_id, customer_name, email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const goCardlessApi = 'https://api-sandbox.gocardless.com'

    // Create billing request via GoCardless API
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
          mandate: { scheme: 'dd' },
          currency: 'GBP',
        },
      }),
    })

    const billingRequestData = await billingRequestResponse.json()

    if (billingRequestData.error) {
      return new Response(
        JSON.stringify({ error: billingRequestData.error.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const billingRequest = billingRequestData.billing_requests?.[0]
    if (!billingRequest) {
      return new Response(
        JSON.stringify({ error: 'Failed to create billing request' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
          exit_uri: `${req.headers.get('origin') || 'http://localhost:3000'}/customers`,
        },
      }),
    })

    const flowData = await flowResponse.json()
    const flow = flowData.billing_request_flows?.[0]

    if (!flow) {
      return new Response(
        JSON.stringify({ error: 'Failed to create billing request flow' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Note: You would typically save mandate to Supabase here using supabase-js
    // For now, return the hosted URL so the frontend can redirect

    return new Response(
      JSON.stringify({
        success: true,
        hosted_url: flow.redirect_url,
        billing_request_id: billingRequest.links.billing_request,
        mandate_id: billingRequest.links.mandate,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})