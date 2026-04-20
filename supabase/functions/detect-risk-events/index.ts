import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RiskEvent {
  event_type: string
  severity: string
  title: string
  description: string
  ai_assessment?: string
  affected_entity_type?: string
  affected_entity_id?: string
  user_id?: string
  ip_address?: string
  risk_score: number
}

function getUKTime(): { hour: number, isOffHours: boolean } {
  const now = new Date()
  const utc = now.getTime() + now.getTimezoneOffset() * 60000
  const ukOffset = 60 * 60000
  const ukTime = new Date(utc + ukOffset)
  const hour = ukTime.getHours()
  return {
    hour,
    isOffHours: hour < 6 || hour >= 22
  }
}

function calculateRiskScore(severity: string): number {
  switch (severity) {
    case 'critical': return 1.0
    case 'high': return 0.75
    case 'medium': return 0.5
    case 'low': return 0.25
    default: return 0.0
  }
}

async function getThresholds(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('risk_thresholds')
    .select('threshold_type, value')
    .eq('is_active', true)

  const thresholds: Record<string, number> = {}
  if (data) {
    for (const t of data) {
      thresholds[t.threshold_type] = t.value
    }
  }
  return thresholds
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

    const body = await req.json()
    const { trigger_type, data: trigger_data, user_id } = body

    const thresholds = await getThresholds(supabase)
    const ukTime = getUKTime()
    const riskEvents: RiskEvent[] = []
    let aiAssessment = null

    if (!trigger_type) {
      return new Response(JSON.stringify({ error: 'trigger_type required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Processing trigger:', trigger_type)

    switch (trigger_type) {
      case 'auth.sign_in': {
        const loginData = trigger_data
        const ip = loginData.ip_address || ''
        
        const { data: recentLogins } = await supabase
          .from('login_attempts')
          .select('country, city, created_at')
          .eq('user_id', user_id)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(30)

        const previousCountries = new Set(recentLogins?.map(l => l.country).filter(Boolean))
        if (loginData.country && !previousCountries.has(loginData.country)) {
          riskEvents.push({
            event_type: 'unusual_login',
            severity: 'high',
            title: 'Login from New Country',
            description: `First login from ${loginData.country}${loginData.city ? ` (${loginData.city})` : ''}. Previous locations: ${Array.from(previousCountries).join(', ') || 'none'}`,
            user_id,
            ip_address: ip,
            risk_score: 0.75
          })
        }

        if (ukTime.isOffHours) {
          riskEvents.push({
            event_type: 'unusual_login',
            severity: 'medium',
            title: 'Login Outside Business Hours',
            description: `Login at ${ukTime.hour}:00 UK time (outside 06:00-22:00)`,
            user_id,
            ip_address: ip,
            risk_score: 0.5
          })
        }

        const { data: recentFailed } = await supabase
          .from('login_attempts')
          .select('id')
          .eq('user_id', user_id)
          .eq('success', false)
          .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

        const failedCount = recentFailed?.length || 0
        if (failedCount > (thresholds['failed_login_attempts_threshold'] || 5) && loginData.success) {
          riskEvents.push({
            event_type: 'repeated_failed_access',
            severity: 'high',
            title: 'Multiple Failed Logins Before Success',
            description: `${failedCount} failed attempts in the last hour before successful login`,
            user_id,
            ip_address: ip,
            risk_score: 0.75
          })
        }

        const { data: existingDevice } = await supabase
          .from('user_sessions')
          .select('id')
          .eq('user_id', user_id)
          .eq('device_fingerprint', loginData.device_fingerprint)
          .single()

        if (!existingDevice && loginData.device_fingerprint) {
          riskEvents.push({
            event_type: 'unusual_login',
            severity: 'medium',
            title: 'Login from New Device',
            description: `New device detected (fingerprint: ${loginData.device_fingerprint.substring(0, 8)}...)`,
            user_id,
            ip_address: ip,
            risk_score: 0.5
          })
        }

        break
      }

      case 'company_settings.update': {
        const settingsData = trigger_data
        const isOffHours = ukTime.isOffHours

        if (settingsData.bank_sort_code || settingsData.bank_account_number) {
          if (isOffHours) {
            riskEvents.push({
              event_type: 'bank_detail_change',
              severity: 'high',
              title: 'Bank Details Changed Off-Hours',
              description: `Bank details modified at ${ukTime.hour}:00 UK time`,
              affected_entity_type: 'company_settings',
              user_id,
              risk_score: 0.75
            })
          } else {
            riskEvents.push({
              event_type: 'bank_detail_change',
              severity: 'high',
              title: 'Bank Details Changed',
              description: `Bank sort code or account number modified${settingsData.changed_by_non_admin ? ' by non-admin user' : ''}`,
              user_id,
              risk_score: 0.75
            })
          }
        }

        if (settingsData.changed_by_non_admin) {
          riskEvents.push({
            event_type: 'bank_detail_change',
            severity: 'critical',
            title: 'Bank Details Changed by Non-Admin',
            description: 'Critical: Bank account details modified by user without admin privileges',
            user_id,
            risk_score: 1.0
          })
        }

        break
      }

      case 'invoice.update':
      case 'invoice.insert': {
        const invoiceData = trigger_data
        
        if (invoiceData.previous_status === 'sent' || invoiceData.previous_status === 'paid') {
          if (invoiceData.total !== invoiceData.previous_total) {
            riskEvents.push({
              event_type: 'invoice_manipulation',
              severity: 'high',
              title: 'Invoice Amount Changed After Send',
              description: `Invoice #${invoiceData.invoice_number} amount changed from £${invoiceData.previous_total} to £${invoiceData.total} after being sent`,
              affected_entity_type: 'invoice',
              affected_entity_id: invoiceData.id,
              user_id,
              risk_score: 0.75
            })
          }
        }

        if (invoiceData.status === 'paid' && !invoiceData.payment_recorded) {
          riskEvents.push({
            event_type: 'invoice_manipulation',
            severity: 'high',
            title: 'Invoice Marked Paid Without Payment Record',
            description: `Invoice #${invoiceData.invoice_number} marked as paid but no payment record exists`,
            affected_entity_type: 'invoice',
            affected_entity_id: invoiceData.id,
            user_id,
            risk_score: 0.75
          })
        }

        const daysInPast = Math.floor((Date.now() - new Date(invoiceData.issue_date).getTime()) / (1000 * 60 * 60 * 24))
        if (daysInPast > 30) {
          riskEvents.push({
            event_type: 'invoice_manipulation',
            severity: 'medium',
            title: 'Backdated Invoice',
            description: `Invoice #${invoiceData.invoice_number} is ${daysInPast} days in the past`,
            affected_entity_type: 'invoice',
            affected_entity_id: invoiceData.id,
            user_id,
            risk_score: 0.5
          })
        }

        if (invoiceData.submitted_by_field_worker && invoiceData.status === 'paid') {
          riskEvents.push({
            event_type: 'invoice_manipulation',
            severity: 'high',
            title: 'Payment Recorded by Field Worker',
            description: 'Invoice marked as paid by field worker (role violation)',
            affected_entity_type: 'invoice',
            affected_entity_id: invoiceData.id,
            user_id,
            risk_score: 0.75
          })
        }

        if (isOffHours && invoiceData.total > 500) {
          riskEvents.push({
            event_type: 'off_hours_activity',
            severity: 'medium',
            title: 'High-Value Invoice Created Off-Hours',
            description: `Invoice #${invoiceData.invoice_number} for £${invoiceData.total} created at ${ukTime.hour}:00 UK time`,
            affected_entity_type: 'invoice',
            affected_entity_id: invoiceData.id,
            user_id,
            risk_score: 0.5
          })
        }

        break
      }

      case 'invoice.delete': {
        const invoiceData = trigger_data

        if (invoiceData.payment_count > 0) {
          riskEvents.push({
            event_type: 'bulk_deletion',
            severity: 'critical',
            title: 'Invoice Deleted With Payments',
            description: `Invoice #${invoiceData.invoice_number} deleted but has ${invoiceData.payment_count} payment record(s)`,
            affected_entity_type: 'invoice',
            affected_entity_id: invoiceData.id,
            user_id,
            risk_score: 1.0
          })
        }

        break
      }

      case 'customer.delete': {
        const deleteData = trigger_data
        const threshold = thresholds['bulk_delete_customers_threshold'] || 5

        if (deleteData.deleted_count > threshold) {
          riskEvents.push({
            event_type: 'bulk_deletion',
            severity: 'high',
            title: 'Bulk Customer Deletion',
            description: `${deleteData.deleted_count} customers deleted in 1 hour`,
            user_id,
            risk_score: 0.75
          })
        }

        break
      }

      case 'route.delete': {
        const routeData = trigger_data

        if (routeData.has_payment_records) {
          riskEvents.push({
            event_type: 'bulk_deletion',
            severity: 'critical',
            title: 'Route Deleted With Payments',
            description: `Route "${routeData.route_name}" deleted but has associated payment records`,
            affected_entity_type: 'route',
            affected_entity_id: routeData.id,
            user_id,
            risk_score: 1.0
          })
        }

        break
      }

      case 'payment.insert': {
        const paymentData = trigger_data

        if (paymentData.amount > paymentData.invoice_total * (thresholds['duplicate_payment_multiplier'] || 2)) {
          riskEvents.push({
            event_type: 'unusual_payment_amount',
            severity: 'medium',
            title: 'Potential Duplicate Payment',
            description: `Payment £${paymentData.amount} exceeds invoice total (£${paymentData.invoice_total}) by ${((paymentData.amount / paymentData.invoice_total - 1) * 100).toFixed(0)}%`,
            affected_entity_type: 'payment',
            affected_entity_id: paymentData.id,
            user_id,
            risk_score: 0.5
          })
        }

        if (paymentData.amount === 0) {
          riskEvents.push({
            event_type: 'unusual_payment_amount',
            severity: 'medium',
            title: 'Zero Payment Amount',
            description: 'Payment of £0.00 recorded',
            affected_entity_type: 'payment',
            affected_entity_id: paymentData.id,
            user_id,
            risk_score: 0.5
          })
        }

        if (paymentData.method_changed && paymentData.user_role === 'field_worker') {
          riskEvents.push({
            event_type: 'unusual_payment_amount',
            severity: 'medium',
            title: 'Payment Method Changed by Field Worker',
            description: 'Payment method changed by field worker (potential role violation)',
            user_id,
            risk_score: 0.5
          })
        }

        const roundedAmount = paymentData.amount % 100 === 0 && paymentData.amount > (thresholds['suspicious_amount_threshold'] || 500)
        if (roundedAmount) {
          riskEvents.push({
            event_type: 'unusual_payment_amount',
            severity: 'low',
            title: 'Round Number Payment',
            description: `Round number payment of £${paymentData.amount}`,
            affected_entity_type: 'payment',
            affected_entity_id: paymentData.id,
            user_id,
            risk_score: 0.25
          })
        }

        break
      }

      case 'mandate.update': {
        const mandateData = trigger_data
        const isOffHours = ukTime.isOffHours

        if (mandateData.cancelled && isOffHours) {
          riskEvents.push({
            event_type: 'mandate_change',
            severity: 'high',
            title: 'Mandate Cancelled Off-Hours',
            description: `GoCardless mandate cancelled at ${ukTime.hour}:00 UK time`,
            affected_entity_type: 'mandate',
            affected_entity_id: mandateData.id,
            user_id,
            risk_score: 0.75
          })
        }

        if (mandateData.cancellation_count > (thresholds['mandate_cancellations_per_day'] || 3)) {
          riskEvents.push({
            event_type: 'mandate_change',
            severity: 'high',
            title: 'Multiple Mandates Cancelled',
            description: `${mandateData.cancellation_count} mandates cancelled today`,
            user_id,
            risk_score: 0.75
          })
        }

        if (Math.abs(paymentData?.amount - paymentData?.invoice_amount) > 1) {
          riskEvents.push({
            event_type: 'mandate_change',
            severity: 'medium',
            title: 'Payment Differs From Invoice',
            description: `Mandate payment (£${paymentData.amount}) differs from invoice (£${paymentData.invoice_amount}) by more than £1`,
            affected_entity_type: 'mandate',
            affected_entity_id: mandateData.id,
            user_id,
            risk_score: 0.5
          })
        }

        break
      }

      case 'expense.insert': {
        const expenseData = trigger_data
        const daysInPast = Math.floor((Date.now() - new Date(expenseData.expense_date).getTime()) / (1000 * 60 * 60 * 24))

        if (daysInPast > 90) {
          riskEvents.push({
            event_type: 'suspicious_expense',
            severity: 'medium',
            title: 'Expensely Backdated Expense',
            description: `Expense submitted ${daysInPast} days after expense date`,
            user_id,
            risk_score: 0.5
          })
        }

        if (expenseData.submitted_by_field_worker) {
          riskEvents.push({
            event_type: 'suspicious_expense',
            severity: 'medium',
            title: 'Expense Submitted by Field Worker',
            description: 'Expense submitted by field worker',
            user_id,
            risk_score: 0.5
          })
        }

        if (isOffHours && expenseData.amount > 200) {
          riskEvents.push({
            event_type: 'off_hours_activity',
            severity: 'medium',
            title: 'High-Value Expense Off-Hours',
            description: `Expense of £${expenseData.amount} created at ${ukTime.hour}:00 UK time`,
            user_id,
            risk_score: 0.5
          })
        }

        break
      }

      case 'data.export': {
        const exportData = trigger_data

        if (exportData.full_customer_export) {
          riskEvents.push({
            event_type: 'data_export_unusual',
            severity: 'medium',
            title: 'Full Customer List Export',
            description: 'Complete customer database exported',
            user_id,
            risk_score: 0.5
          })
        }

        if (exportData.export_count > 1) {
          riskEvents.push({
            event_type: 'data_export_unusual',
            severity: 'medium',
            title: 'Multiple Exports in Single Day',
            description: `${exportData.export_count} exports performed today`,
            user_id,
            risk_score: 0.5
          })
        }

        if (exportData.is_new_user) {
          riskEvents.push({
            event_type: 'data_export_unusual',
            severity: 'low',
            title: 'Export by New User',
            description: 'Data exported by user within first 7 days',
            user_id,
            risk_score: 0.25
          })
        }

        if (exportData.audit_log_export) {
          riskEvents.push({
            event_type: 'data_export_unusual',
            severity: 'high',
            title: 'Audit Log Export',
            description: 'System audit log exported',
            user_id,
            risk_score: 0.75
          })
        }

        break
      }

      case 'customer.update': {
        const customerData = trigger_data

        if (customerData.email_changed && customerData.has_active_mandate) {
          riskEvents.push({
            event_type: 'customer_data_change',
            severity: 'high',
            title: 'Email Changed on Customer with Active Mandate',
            description: `Customer email changed from ${customerData.previous_email} to ${customerData.new_email} despite active direct debit`,
            affected_entity_type: 'customer',
            affected_entity_id: customerData.id,
            user_id,
            risk_score: 0.75
          })
        }

        if (customerData.bank_details_changed) {
          riskEvents.push({
            event_type: 'customer_data_change',
            severity: 'high',
            title: 'Bank Account Details Changed',
            description: 'Customer bank account details modified',
            affected_entity_type: 'customer',
            affected_entity_id: customerData.id,
            user_id,
            risk_score: 0.75
          })
        }

        if (customerData.portal_token_regenerated > (thresholds['portal_token_regeneration_limit'] || 3)) {
          riskEvents.push({
            event_type: 'customer_data_change',
            severity: 'medium',
            title: 'Frequent Portal Token Regeneration',
            description: `Portal token regenerated ${customerData.portal_token_regenerated} times in ${thresholds['token_regeneration_window_days'] || 30} days`,
            affected_entity_type: 'customer',
            affected_entity_id: customerData.id,
            user_id,
            risk_score: 0.5
          })
        }

        if (customerData.address_changed && customerData.monthly_value > 500) {
          riskEvents.push({
            event_type: 'customer_data_change',
            severity: 'high',
            title: 'Address Changed on High-Value Customer',
            description: `Address changed on customer with £${customerData.monthly_value}/month spend`,
            affected_entity_type: 'customer',
            affected_entity_id: customerData.id,
            user_id,
            risk_score: 0.75
          })
        }

        if (isOffHours && customerData.changed_by_non_admin) {
          riskEvents.push({
            event_type: 'off_hours_activity',
            severity: 'medium',
            title: 'Customer Modified Off-Hours by Non-Admin',
            description: `Customer record modified at ${ukTime.hour}:00 UK time by non-admin user`,
            affected_entity_type: 'customer',
            affected_entity_id: customerData.id,
            user_id,
            risk_score: 0.5
          })
        }

        break
      }

      case 'daily.batch': {
        const batchData = trigger_data

        const { data: recentInvoices } = await supabase
          .from('invoices')
          .select('id, total, issue_date, status, created_at')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .gt('total', 500)

        for (const inv of recentInvoices || []) {
          const hour = new Date(inv.created_at).getHours()
          if (hour < 6 || hour >= 22) {
            riskEvents.push({
              event_type: 'off_hours_activity',
              severity: 'medium',
              title: 'High-Value Invoice Created Off-Hours',
              description: `Invoice for £${inv.total} created at ${hour}:00 UK time`,
              affected_entity_type: 'invoice',
              affected_entity_id: inv.id,
              risk_score: 0.5
            })
          }
        }

        const { data: recentExpenses } = await supabase
          .from('expenses')
          .select('id, amount, expense_date, created_at, submitted_by')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .gt('amount', 200)

        for (const exp of recentExpenses || []) {
          const hour = new Date(exp.created_at).getHours()
          if (hour < 6 || hour >= 22) {
            riskEvents.push({
              event_type: 'off_hours_activity',
              severity: 'medium',
              title: 'High-Value Expense Created Off-Hours',
              description: `Expense of £${exp.amount} created at ${hour}:00 UK time`,
              affected_entity_type: 'expense',
              affected_entity_id: exp.id,
              user_id: exp.submitted_by,
              risk_score: 0.5
            })
          }
        }

        const { data: duplicateExpenses } = await supabase
          .from('expenses')
          .select('id, amount, submitted_by, expense_date')
          .gte('expense_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

        const amountCounts = new Map<number, number[]>()
        for (const exp of duplicateExpenses || []) {
          const key = Math.round(exp.amount * 100) / 100
          if (!amountCounts.has(key)) {
            amountCounts.set(key, [])
          }
          amountCounts.get(key)!.push(exp.id)
        }

        for (const [amount, ids] of amountCounts) {
          if (ids.length > 1) {
            riskEvents.push({
              event_type: 'suspicious_expense',
              severity: 'medium',
              title: 'Duplicate Expense Amounts',
              description: `${ids.length} expenses of £${amount} submitted today`,
              user_id: duplicateExpenses?.find(e => e.amount === amount)?.submitted_by,
              risk_score: 0.5
            })
          }
        }

        break
      }
    }

    if (riskEvents.length > 0) {
      for (const event of riskEvents) {
        if (!event.risk_score) {
          event.risk_score = calculateRiskScore(event.severity)
        }
      }

      if (["high", "critical"].includes(riskEvents[0].severity) && anthropicKey) {
        const assessmentBody = {
          events: riskEvents,
          context: {
            trigger_type,
            user_id,
            timestamp: new Date().toISOString()
          }
        }

        try {
          const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 500,
              system: 'You are a fraud detection analyst. Analyze the following risk events and provide an assessment.',
              messages: [{
                role: 'user',
                content: `Analyze these risk events and provide: 1) likelihood of fraud vs error vs normal (percentage), 2) recommended immediate actions, 3) whether user should be suspended (yes/no), 4) any additional information needed. Events: ${JSON.stringify(assessmentBody)}`
              }]
            })
          })

          if (aiResponse.ok) {
            const aiData = await aiResponse.json()
            aiAssessment = aiData.content?.[0]?.text || null
          }
        } catch (e) {
          console.error('AI assessment failed:', e)
        }
      }

      const eventsToInsert = riskEvents.map(e => ({
        ...e,
        ai_assessment: aiAssessment
      }))

      const { error: insertError } = await supabase
        .from('risk_events')
        .insert(eventsToInsert)

      if (insertError) {
        console.error('Failed to insert risk events:', insertError)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      trigger_type,
      events_detected: riskEvents.length,
      events: riskEvents,
      ai_assessment: aiAssessment
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in detect-risk-events:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}