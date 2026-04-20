import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { invoice_id, fix_type } = await req.json()
    
    if (!invoice_id) {
      return new Response(JSON.stringify({ error: 'invoice_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const fixes_applied: string[] = []

    // Fetch invoice with items
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*, invoice_items(*), customers(*)')
      .eq('id', invoice_id)
      .single()

    if (invoiceError || !invoice) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // FIX 1: VAT Calculation Error
    if (fix_type === 'vat_fix' || fix_type === 'auto') {
      const expectedVat = invoice.subtotal * invoice.vat_rate
      const vatDiff = Math.abs(expectedVat - invoice.vat_amount)
      
      if (vatDiff > 0.01) {
        await supabase
          .from('invoices')
          .update({ vat_amount: expectedVat, total: invoice.subtotal + expectedVat })
          .eq('id', invoice_id)
        
        fixes_applied.push(`Fixed VAT: was £${invoice.vat_amount.toFixed(2)}, now £${expectedVat.toFixed(2)}`)
      }
    }

    // FIX 2: Duplicate Line Items (merge them)
    if (fix_type === 'dedupe_fix' || fix_type === 'auto') {
      const items = invoice.invoice_items || []
      const seen = new Map<string, { quantity: number, ids: string[] }>()
      
      for (const item of items) {
        const key = `${item.description.toLowerCase()}-${item.unit_price}`
        if (!seen.has(key)) {
          seen.set(key, { quantity: 0, ids: [] })
        }
        const entry = seen.get(key)!
        entry.quantity += item.quantity
        entry.ids.push(item.id)
      }
      
      for (const [key, entry] of seen) {
        if (entry.ids.length > 1) {
          const primaryId = entry.ids[0]
          const mergedQuantity = entry.quantity
          
          // Update primary item
          await supabase
            .from('invoice_items')
            .update({ quantity: mergedQuantity, line_total: mergedQuantity * (items.find(i => i.id === primaryId)?.unit_price || 0) })
            .eq('id', primaryId)
          
          // Delete duplicates
          await supabase
            .from('invoice_items')
            .delete()
            .in('id', entry.ids.slice(1))
          
          fixes_applied.push(`Merged ${entry.ids.length} duplicate line items into one`)
        }
      }
    }

    // FIX 3: Missing VAT on taxable items
    if (fix_type === 'vat_missing_fix' || fix_type === 'auto') {
      const items = invoice.invoice_items || []
      
      for (const item of items) {
        const isTaxableDescription = /clean|service|work|labour|hour/i.test(item.description)
        if (isTaxableDescription && item.vat_rate === 0) {
          const correctVat = item.line_total * 0.20
          
          await supabase
            .from('invoice_items')
            .update({ vat_rate: 0.20 })
            .eq('id', item.id)
          
          fixes_applied.push(`Added 20% VAT to "${item.description}"`)
        }
      }
    }

    // Recalculate totals after fixes
    const { data: updatedItems } = await supabase
      .from('invoice_items')
      .select('quantity, unit_price, vat_rate')
      .eq('invoice_id', invoice_id)

    if (updatedItems && updatedItems.length > 0) {
      const subtotal = updatedItems.reduce((sum, item) => 
        sum + (item.quantity * item.unit_price), 0)
      const vatAmount = updatedItems.reduce((sum, item) => 
        sum + (item.quantity * item.unit_price * item.vat_rate), 0)
      
      await supabase
        .from('invoices')
        .update({ 
          subtotal, 
          vat_amount: vatAmount, 
          total: subtotal + vatAmount 
        })
        .eq('id', invoice_id)
    }

    // Clear resolved anomalies
    await supabase
      .from('invoice_anomalies')
      .update({ status: 'resolved', resolution_note: `Auto-fixed: ${fixes_applied.join(', ')}` })
      .eq('invoice_id', invoice_id)
      .eq('status', 'open')
      .in('anomaly_type', ['vat_calculation_error', 'duplicate_line_item', 'missing_vat'])

    return new Response(JSON.stringify({ 
      success: true, 
      invoice_id,
      fixes_applied,
      message: fixes_applied.length > 0 
        ? `Applied ${fixes_applied.length} fixes` 
        : 'No fixes needed'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}