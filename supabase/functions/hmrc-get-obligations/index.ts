import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HMRC_SANDBOX_BASE_URL = 'https://test-api.service.hmrc.gov.uk'
const HMRC_LIVE_BASE_URL = 'https://api.service.hmrc.gov.uk'

const ENVIRONMENT = Deno.env.get('VITE_HMRC_ENVIRONMENT') || 'sandbox'

const BASE_URL = ENVIRONMENT === 'live' ? HMRC_LIVE_BASE_URL : HMRC_SANDBOX_BASE_URL

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

function getSupabase() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration')
  }
  return createClient(supabaseUrl, supabaseKey)
}

function getFraudPreventionHeaders() {
  return {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Timezone': 'Europe/London',
    'Gov-Client-User-Agent': 'ClearRoute/1.0',
    'Gov-Vendor-Version': 'ClearRoute=1.0.0'
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const { accessToken, vrn } = await req.json()

    if (!accessToken || !vrn) {
      return new Response(JSON.stringify({ error: 'Access token and VRN are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const obligationsUrl = `${BASE_URL}/organisations/vat/${vrn}/obligations`
    
    const fromDate = new Date()
    fromDate.setMonth(fromDate.getMonth() - 6)
    const toDate = new Date()
    toDate.setMonth(toDate.getMonth() + 6)

    const url = new URL(obligationsUrl)
    url.searchParams.set('from', fromDate.toISOString().split('T')[0])
    url.searchParams.set('to', toDate.toISOString().split('T')[0])
    url.searchParams.set('status', 'open,fulfilled')

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.hmrc.1.0+json',
        ...getFraudPreventionHeaders()
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('HMRC obligations error:', errorText)
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch obligations',
        details: errorText
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const data = await response.json()
    const obligations = data.obligations || []

    const supabase = getSupabase()

    for (const obs of obligations) {
      const { error: upsertError } = await supabase
        .from('vat_returns')
        .upsert({
          period_key: obs.periodKey,
          period_start: obs.start,
          period_end: obs.end,
          due_date: obs.due,
          status: obs.status === 'F' ? 'submitted' : 'open'
        }, { onConflict: 'period_key' })

      if (upsertError) {
        console.error('Failed to upsert obligation:', upsertError)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      obligations: obligations.map((o: any) => ({
        periodKey: o.periodKey,
        periodStart: o.start,
        periodEnd: o.end,
        dueDate: o.due,
        status: o.status === 'F' ? 'fulfilled' : o.status === 'O' ? 'open' : 'overdue'
      }))
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('HMRC Get Obligations Error:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to get obligations',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})