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

    const { accessToken, vrn, periodKey, box1, box2, box4, box6, box7, box8, box9 } = await req.json()

    if (!accessToken || !vrn || !periodKey) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Calculate derived boxes
    const box3 = (box1 || 0) + (box2 || 0)
    const box5 = box3 - (box4 || 0)

    const vatReturn = {
      periodKey,
      vatDueSales: box1 || 0,
      vatDueAcquisitions: box2 || 0,
      totalVatDue: box3,
      vatReclaimed: box4 || 0,
      netVatDue: box5,
      totalValueSalesExVAT: box6 || 0,
      totalValuePurchasesExVAT: box7 || 0,
      totalValueSuppliesExVAT: box8 || 0,
      totalValueAcquisitionsExVAT: box9 || 0
    }

    const submitUrl = `${BASE_URL}/organisations/vat/${vrn}/returns`
    
    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.hmrc.1.0+json',
        ...getFraudPreventionHeaders()
      },
      body: JSON.stringify(vatReturn)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('HMRC submit error:', errorText)
      
      let errorMessage = 'Failed to submit VAT return'
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.code ? errorData.code : errorData.message || errorText
      } catch {}

      return new Response(JSON.stringify({ 
        error: errorMessage,
        details: errorText
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const result = await response.json()

    const supabase = getSupabase()

    // Update local record
    await supabase
      .from('vat_returns')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submission_reference: result.formBundleNumber || result.receiptNumber,
        box_1: box1,
        box_2: box2,
        box_3: box3,
        box_4: box4,
        box_5: box5,
        box_6: box6,
        box_7: box7,
        box_8: box8,
        box_9: box9,
        updated_at: new Date().toISOString()
      })
      .eq('period_key', periodKey)

    // Log activity
    await supabase
      .from('activity_log')
      .insert([{
        user_id: 'system',
        event_type: 'vat_return_submitted',
        description: `VAT return submitted for period ${periodKey}`,
        metadata: JSON.stringify({
          periodKey,
          formBundleNumber: result.formBundleNumber,
          netVat: box5
        })
      }])

    return new Response(JSON.stringify({
      success: true,
      submissionReference: result.formBundleNumber || result.receiptNumber,
      receivedAt: result.receivedAt,
      periodKey
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('HMRC Submit Return Error:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to submit VAT return',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})