import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUBSTITUTIONS = {
  '{{customer_name}}': 'name',
  '{{invoice_number}}': 'invoice_number',
  '{{invoice_total}}': (invoice) => `£${invoice.total || 0}`,
  '{{due_date}}': 'due_date',
  '{{company_name}}': 'company_name',
}

function substitutePlaceholders(text: string, data: Record<string, unknown>): string {
  let result = text
  for (const [placeholder, key] of Object.entries(SUBSTITUTIONS)) {
    if (typeof key === 'function') {
      result = result.replaceAll(placeholder, key(data))
    } else {
      result = result.replaceAll(placeholder, String(data[key] || ''))
    }
  }
  return result
}

async function generateInvoicePDF(invoice: unknown, customer: unknown, company: unknown): Promise<Uint8Array> {
  // Simplified PDF generation - in production use jspdf
  const content = `
    INVOICE ${invoice.invoice_number}
    From: ${company.company_name}
    To: ${customer.name}
    ${customer.address_line_1}
    ${customer.city}, ${customer.postcode}
    
    Total: £${invoice.total}
    Due: ${invoice.due_date}
  `
  return new TextEncoder().encode(content)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')
  const FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'noreply@clearroute.co.uk'
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!SENDGRID_API_KEY || !SUPABASE_URL) {
    return new Response(
      JSON.stringify({ error: 'Email configuration missing' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { invoice_id } = await req.json()

    // Use dynamic import for supabase
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Get company settings
    const { data: company } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single()

    // Get email template
    const { data: template } = await supabase
      .from('email_templates')
      .select('*')
      .eq('template_type', 'invoice')
      .single()

    if (!template) {
      return new Response(
        JSON.stringify({ error: 'Invoice email template not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get invoice with customer
    const { data: invoice } = await supabase
      .from('invoices')
      .select('*, customers(*)')
      .eq('id', invoice_id)
      .single()

    if (!invoice) {
      return new Response(
        JSON.stringify({ error: 'Invoice not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const customer = invoice.customers
    const email = customer?.email

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Customer email not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Substitute placeholders
    const subject = substitutePlaceholders(template.subject, { ...invoice, ...customer, ...company })
    const body = substitutePlaceholders(template.body, { ...invoice, ...customer, ...company })

    // Generate PDF attachment
    const pdfContent = await generateInvoicePDF(invoice, customer, company)

    // Send via SendGrid
    const sendGridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email, name: customer?.name }] }],
        from: { email: FROM_EMAIL, name: company?.company_name || 'ClearRoute' },
        subject,
        content: [{ type: 'text/plain', value: body }],
        attachments: [
          {
            content: btoa(String.fromCharCode(...pdfContent)),
            filename: `${invoice.invoice_number}.pdf`,
            type: 'application/pdf',
            disposition: 'attachment',
          },
        ],
      }),
    })

    // Log the email
    await supabase.from('email_log').insert({
      template_type: 'invoice',
      customer_id: customer?.id,
      invoice_id,
      to_email: email,
      subject,
      status: sendGridResponse.ok ? 'sent' : 'failed',
    })

    // Update invoice status
    if (sendGridResponse.ok) {
      await supabase
        .from('invoices')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', invoice_id)
    }

    return new Response(
      JSON.stringify({ success: true, status: sendGridResponse.ok ? 'sent' : 'failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Email error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})