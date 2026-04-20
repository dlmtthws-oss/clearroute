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

async function refreshToken(supabase: any, connection: any): Promise<boolean> {
  if (!connection.refresh_token) {
    return false
  }

  const tokenUrl = new URL(`${BASE_URL}/oauth/token`)
  const tokenParams = new URLSearchParams()
  tokenParams.set('grant_type', 'refresh_token')
  tokenParams.set('client_id', HMRC_CLIENT_ID)
  tokenParams.set('client_secret', HMRC_CLIENT_SECRET)
  tokenParams.set('refresh_token', connection.refresh_token)

  const tokenResponse = await fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenParams.toString()
  })

  if (!tokenResponse.ok) {
    console.error('Token refresh failed:', await tokenResponse.text())
    return false
  }

  const tokenData = await tokenResponse.json()
  
  const expiresAt = new Date()
  expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 3600))

  await supabase
    .from('hmrc_connections')
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || connection.refresh_token,
      token_expires_at: expiresAt.toISOString()
    })
    .eq('vrn', connection.vrn)

  return true
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabase = getSupabase()
    
    const { data: connection } = await supabase
      .from('hmrc_connections')
      .select('*')
      .eq('is_active', true)
      .single()

    if (!connection) {
      return new Response(JSON.stringify({ error: 'No HMRC connection found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const expiresAt = new Date(connection.token_expires_at)
    const now = new Date()
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000)

    let accessToken = connection.access_token
    
    if (expiresAt <= fiveMinutesFromNow) {
      const refreshed = await refreshToken(supabase, connection)
      if (!refreshed) {
        return new Response(JSON.stringify({ error: 'Failed to refresh token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      
      const { data: updatedConnection } = await supabase
        .from('hmrc_connections')
        .select('access_token')
        .eq('vrn', connection.vrn)
        .single()
      
      accessToken = updatedConnection?.access_token
    }

    return new Response(JSON.stringify({
      success: true,
      access_token: accessToken,
      vrn: connection.vrn
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('HMRC Refresh Token Error:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to refresh token',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})