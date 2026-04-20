import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HMRC_SANDBOX_BASE_URL = 'https://test-api.service.hmrc.gov.uk'
const HMRC_LIVE_BASE_URL = 'https://api.service.hmrc.gov.uk'

const HMRC_CLIENT_ID = Deno.env.get('HMRC_CLIENT_ID') || ''
const HMRC_CLIENT_SECRET = Deno.env.get('HMRC_CLIENT_SECRET') || ''
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

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const { code, state, vrn } = await req.json()

    if (!code || !vrn) {
      return new Response(JSON.stringify({ error: 'Code and VRN are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const redirectUri = `${req.headers.get('origin') || 'http://localhost:3000'}/api/hmrc/callback`

    const tokenUrl = new URL(`${BASE_URL}/oauth/token`)
    const tokenParams = new URLSearchParams()
    tokenParams.set('grant_type', 'authorization_code')
    tokenParams.set('client_id', HMRC_CLIENT_ID)
    tokenParams.set('client_secret', HMRC_CLIENT_SECRET)
    tokenParams.set('code', code)
    tokenParams.set('redirect_uri', redirectUri)

    const tokenResponse = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString()
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token exchange error:', errorText)
      return new Response(JSON.stringify({ 
        error: 'Failed to exchange code for token',
        details: errorText
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const tokenData = await tokenResponse.json()
    
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 3600))

    const supabase = getSupabase()
    
    const { error: insertError } = await supabase
      .from('hmrc_connections')
      .upsert({
        vrn: vrn,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt.toISOString(),
        is_active: true,
        connected_at: new Date().toISOString()
      }, { onConflict: 'vrn' })

    if (insertError) {
      console.error('Database insert error:', insertError)
      return new Response(JSON.stringify({ 
        error: 'Failed to store connection',
        details: insertError.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      connected: true,
      vrn: vrn
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('HMRC OAuth Callback Error:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to complete OAuth flow',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})