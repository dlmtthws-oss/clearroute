import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOCARDLESS_WEBHOOK_SECRET = Deno.env.get('GOCARDLESS_WEBHOOK_SECRET') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type, X-GoCardless-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function verifySignature(body: string, signature: string): boolean {
  if (!GOCARDLESS_WEBHOOK_SECRET || !signature) return true
  const encoder = new TextEncoder()
  const keyData = encoder.encode(GOCARDLESS_WEBHOOK_SECRET)
  const bodyData = encoder.encode(body)
  return crypto.subtle.timingSafeEqual(keyData, bodyData)
}

async function createNotification(supabase, userId, title, message, type = 'info') {
  await supabase.from('notifications').insert([{
    user_id: userId,
    title,
    message,
    type
  }])
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const signature = req.headers.get('X-GoCardless-Signature') || ''
    const body = await req.text()
    
    if (!verifySignature(body, signature)) {
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const payload = JSON.parse(body)
    const eventType = payload.events?.[0]?.resource_type || payload.resource_type
    const action = payload.events?.[0]?.action || payload.action

    if (eventType === 'mandates') {
      const mandate = payload.events?.[0]?.links?.mandate || payload.links?.mandate
      if (mandate) {
        let status = 'pending'
        if (action === 'activated') status = 'active'
        else if (action === 'cancelled') status = 'cancelled'
        else if (action === 'failed') status = 'failed'
        
        await supabase
          .from('gocardless_mandates')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('gc_mandate_id', mandate)
      }
    }

    if (eventType === 'payments') {
      const payment = payload.events?.[0]?.links?.payment || payload.links?.payment
      const scheme = payload.events?.[0]?.links?.scheme || payload.scheme
      
      if (payment) {
        let status = 'pending_submission'
        if (action === 'submitted') status = 'submitted'
        else if (action === 'confirmed') status = 'confirmed'
        else if (action === 'paid_out') status = 'paid_out'
        else if (action === 'failed') status = 'failed'
        else if (action === 'cancelled') status = 'cancelled'

        const updateData: any = { status, updated_at: new Date().toISOString() }
        
        if (status === 'confirmed' || status === 'paid_out') {
          const gcPayment = await supabase
            .from('gocardless_payments')
            .select('*, invoices(customer_id)')
            .eq('gc_payment_id', payment)
            .single()
          
          if (gcPayment?.data?.invoice_id) {
            const { data: inv } = await supabase
              .from('invoices')
              .select('customer_id')
              .eq('id', gcPayment.data.invoice_id)
              .single()
            
            await supabase
              .from('invoices')
              .update({ status: 'paid', paid_at: new Date().toISOString() })
              .eq('id', gcPayment.data.invoice_id)
            
            await supabase.from('payments').insert([{
              invoice_id: gcPayment.data.invoice_id,
              amount: gcPayment.data.amount,
              payment_date: new Date().toISOString().split('T')[0],
              method: 'direct_debit',
              reference: payment
            }])
            
            if (inv?.data?.customer_id) {
              await createNotification(
                supabase,
                inv.data.customer_id,
                'Payment Received',
                `Payment of £${gcPayment.data.amount} received via Direct Debit`
              )
            }
          }
        }
        
        if (status === 'failed') {
          const gcPayment = await supabase
            .from('gocardless_payments')
            .select('*, invoices(customer_id)')
            .eq('gc_payment_id', payment)
            .single()
          
          if (gcPayment?.data?.invoice_id) {
            await supabase
              .from('invoices')
              .update({ status: 'sent' })
              .eq('id', gcPayment.data.invoice_id)
            
            await createNotification(
              supabase,
              gcPayment.data.customer_id || '',
              'Payment Failed',
              `Direct Debit payment of £${gcPayment.data.amount} failed`,
              'error'
            )
          }
        }

        await supabase
          .from('gocardless_payments')
          .update(updateData)
          .eq('gc_payment_id', payment)
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})