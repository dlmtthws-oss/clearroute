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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { invoice_id, amount, description, charge_date } = await req.json()

    if (!invoice_id || !amount) {
      return new Response(
        JSON.stringify({ error: 'Missing invoice_id or amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: invoice } = await supabase
      .from('invoices')
      .select('*, customers!inner(gc_mandate_id)')
      .eq('id', invoice_id)
      .single()

    if (!invoice) {
      return new Response(
        JSON.stringify({ error: 'Invoice not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!invoice.customers?.gc_mandate_id) {
      return new Response(
        JSON.stringify({ error: 'Customer does not have active Direct Debit mandate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: mandate } = await supabase
      .from('gocardless_mandates')
      .select('*')
      .eq('id', invoice.customers.gc_mandate_id)
      .single()

    if (!mandate || mandate.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Mandate is not active' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const defaultChargeDate = new Date()
    defaultChargeDate.setDate(defaultChargeDate.getDate() + 2)
    const paymentDate = charge_date || defaultChargeDate.toISOString().split('T')[0]

    const paymentResponse = await fetch(`${goCardlessApi}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GOCARDLESS_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'GoCardless-Version': '2015-01-01',
      },
      body: JSON.stringify({
        payment: {
          amount: Math.round(amount * 100),
          currency: 'GBP',
          description: description || `Invoice ${invoice.invoice_number}`,
          charge_date: paymentDate,
          links: {
            mandate: mandate.gc_mandate_id
          }
        }
      })
    })

    const paymentData = await paymentResponse.json()

    if (paymentData.errors) {
      return new Response(
        JSON.stringify({ error: paymentData.errors[0].message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const gcPayment = paymentData.payments?.[0] || paymentData

    const { data: savedPayment } = await supabase.from('gocardless_payments').insert([{
      invoice_id,
      mandate_id: mandate.id,
      gc_payment_id: gcPayment.id,
      amount: amount,
      status: 'submitted',
      charge_date: paymentDate,
      description: description || `Invoice ${invoice.invoice_number}`
    }]).select().single()

    if (savedPayment) {
      await supabase
        .from('invoices')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', invoice_id)
    }

    return new Response(
      JSON.stringify({ success: true, payment: gcPayment }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Error creating payment:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})