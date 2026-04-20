import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function generateInvoiceNumber(supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>): Promise<string> {
  const { data, error } = await supabase.rpc('generate_invoice_number')
  if (error || !data) {
    const year = new Date().getFullYear()
    const { data: countData } = await supabase.from('invoices').select('id', { count: 'exact' })
    const count = (countData?.length || 0) + 1
    return `INV-${year}-${String(count).padStart(4, '0')}`
  }
  return data
}

function calculateNextRunDate(
  lastRunDate: string | null,
  frequency: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null
): string {
  if (!lastRunDate) {
    return new Date().toISOString().split('T')[0]
  }

  const lastDate = new Date(lastRunDate)
  let nextDate: Date

  switch (frequency) {
    case 'weekly':
      nextDate = new Date(lastDate)
      nextDate.setDate(lastDate.getDate() + 7)
      break
    case 'fortnightly':
      nextDate = new Date(lastDate)
      nextDate.setDate(lastDate.getDate() + 14)
      break
    case 'monthly': {
      nextDate = new Date(lastDate)
      nextDate.setMonth(lastDate.getMonth() + 1)
      const actualDay = dayOfMonth || lastDate.getDate()
      nextDate.setDate(Math.min(actualDay, 28))
      break
    }
    case 'quarterly': {
      nextDate = new Date(lastDate)
      nextDate.setMonth(lastDate.getMonth() + 3)
      const actualDay = dayOfMonth || lastDate.getDate()
      nextDate.setDate(Math.min(actualDay, 28))
      break
    }
    case 'annually':
      nextDate = new Date(lastDate)
      nextDate.setFullYear(lastDate.getFullYear() + 1)
      if (dayOfMonth) {
        nextDate.setDate(Math.min(dayOfMonth, 28))
      }
      break
    default:
      nextDate = new Date(lastDate)
      nextDate.setDate(lastDate.getDate() + 30)
  }

  return nextDate.toISOString().split('T')[0]
}

async function hasActiveMandate(supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>, customerId: string): Promise<boolean> {
  const { data } = await supabase
    .from('gocardless_mandates')
    .select('id')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .limit(1)
  return (data?.length || 0) > 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Configuration missing' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const today = new Date().toISOString().split('T')[0]
  
  // Get all active templates due for processing
  const { data: templates, error: templatesError } = await supabase
    .from('recurring_invoice_templates')
    .select('*, recurring_invoice_line_items(*), customers(*)')
    .eq('is_active', true)
    .lte('next_run_date', today)

  if (templatesError) {
    return new Response(
      JSON.stringify({ error: templatesError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const results = { processed: 0, failed: 0, errors: [] as string[] }

  for (const template of templates || []) {
    try {
      // Calculate totals
      const subtotal = template.recurring_invoice_line_items?.reduce(
        (sum: number, item: { quantity: number; unit_price: number }) => sum + (item.quantity * item.unit_price),
        0
      ) || 0
      const vatAmount = template.recurring_invoice_line_items?.reduce(
        (sum: number, item: { quantity: number; unit_price: number; vat_rate: number }) =>
          sum + (item.quantity * item.unit_price * item.vat_rate / 100),
        0
      ) || 0
      const total = subtotal + vatAmount
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + (template.payment_terms || 30))

      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber(supabase)

      // Create the invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: invoiceNumber,
          customer_id: template.customer_id,
          recurring_template_id: template.id,
          status: template.auto_collect ? 'pending_collection' : 'draft',
          issue_date: today,
          due_date: dueDate.toISOString().split('T')[0],
          subtotal,
          vat_amount: vatAmount,
          total,
        })
        .select()
        .single()

      if (invoiceError) {
        throw new Error(`Failed to create invoice: ${invoiceError.message}`)
      }

      // Copy line items
      if (template.recurring_invoice_line_items) {
        const lineItems = template.recurring_invoice_line_items.map((item: { description: string; quantity: number; unit_price: number; vat_rate: number }) => ({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
          line_total: item.quantity * item.unit_price * (1 + item.vat_rate / 100),
        })))

        const { error: lineItemsError } = await supabase
          .from('invoice_line_items')
          .insert(lineItems)

        if (lineItemsError) {
          throw new Error(`Failed to create line items: ${lineItemsError.message}`)
        }
      }

      // Handle auto-collect if enabled
      if (template.auto_collect) {
        const hasMandate = await hasActiveMandate(supabase, template.customer_id)
        
        if (hasMandate) {
          // Call GoCardless payment function - in production would trigger async
          console.log(`Would trigger GoCardless payment for invoice ${invoiceNumber}`)
          
          // Call send-invoice-email
          console.log(`Would send invoice email for ${invoiceNumber}`)
        } else {
          // No mandate, mark as draft instead
          await supabase
            .from('invoices')
            .update({ status: 'draft' })
            .eq('id', invoice.id)
        }
      } else if (template.send_on_create) {
        // Send invoice email
        console.log(`Would send invoice email for ${invoiceNumber}`)
      }

      // Update template with new dates
      const nextRunDate = calculateNextRunDate(
        today,
        template.frequency,
        template.day_of_week,
        template.day_of_month
      )

      await supabase
        .from('recurring_invoice_templates')
        .update({
          last_run_date: today,
          next_run_date: nextRunDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', template.id)

      // Log activity
      await supabase.from('activity_log').insert({
        event_type: 'invoice_generated',
        description: `Auto-generated invoice ${invoiceNumber} for ${template.customers?.name}`,
        entity_type: 'invoice',
        entity_id: invoice.id,
      })

      results.processed++
    } catch (error) {
      results.failed++
      results.errors.push(`Template ${template.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      
      // Log failure
      await supabase.from('activity_log').insert({
        event_type: 'invoice_generation_failed',
        description: `Failed to generate invoice for ${template.customers?.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        entity_type: 'invoice',
        entity_id: template.id,
      })
    }
  }

  return new Response(
    JSON.stringify(results),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})