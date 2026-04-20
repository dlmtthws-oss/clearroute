const HMRC_SANDBOX_BASE_URL = 'https://test-api.service.hmrc.gov.uk'
const HMRC_LIVE_BASE_URL = 'https://api.service.hmrc.gov.uk'

const HMRC_CLIENT_ID = Deno.env.get('HMRC_CLIENT_ID') || ''
const HMRC_CLIENT_SECRET = Deno.env.get('HMRC_CLIENT_SECRET') || ''
const ENVIRONMENT = Deno.env.get('VITE_HMRC_ENVIRONMENT') || 'sandbox'

const BASE_URL = ENVIRONMENT === 'live' ? HMRC_LIVE_BASE_URL : HMRC_SANDBOX_BASE_URL

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const { vrn } = await req.json()

    if (!vrn) {
      return new Response(JSON.stringify({ error: 'VRN is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const state = crypto.randomUUID()
    
    const scopes = 'write:vat read:vat'
    const redirectUri = `${req.headers.get('origin') || 'http://localhost:3000'}/api/hmrc/callback`
    
    const authUrl = new URL(`${BASE_URL}/oauth/authorize`)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', HMRC_CLIENT_ID)
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', state)

    return new Response(JSON.stringify({
      authUrl: authUrl.toString(),
      state
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('HMRC OAuth Start Error:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to generate OAuth URL',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
