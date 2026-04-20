import { supabase } from './supabase'

export async function createBillingRequest(customerId, customerData) {
  try {
    const { data, error } = await supabase.functions.invoke('gocardless-create-billing-request', {
      body: {
        customer_id: customerId,
        customer_name: customerData.name,
        email: customerData.email,
        address_line_1: customerData.address_line_1,
        city: customerData.city,
        postcode: customerData.postcode
      }
    })
    if (error) throw error
    return data
  } catch (err) {
    console.error('GoCardless billing request error:', err)
    return { error: err.message }
  }
}

export async function createPayment(invoiceId, amount, description, chargeDate) {
  try {
    const { data, error } = await supabase.functions.invoke('gocardless-create-payment', {
      body: {
        invoice_id: invoiceId,
        amount: Math.round(amount * 100),
        description,
        charge_date: chargeDate
      }
    })
    if (error) throw error
    return data
  } catch (err) {
    console.error('GoCardless payment error:', err)
    return { error: err.message }
  }
}

export async function getMandate(customerId) {
  const { data, error } = await supabase
    .from('gocardless_mandates')
    .select('*')
    .eq('customer_id', customerId)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data || null
}

export async function getActiveMandates() {
  const { data, error } = await supabase
    .from('gocardless_mandates')
    .select('*, customers(name)')
    .eq('status', 'active')
  if (error) throw error
  return data || []
}

export async function getPayments(status = null) {
  let query = supabase
    .from('gocardless_payments')
    .select('*, invoices(invoice_number), gocardless_mandates(customers(name))')
  
  if (status) {
    query = query.eq('status', status)
  }
  
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function retryPayment(paymentId) {
  try {
    const { data, error } = await supabase.functions.invoke('gocardless-retry-payment', {
      body: { payment_id: paymentId }
    })
    if (error) throw error
    return data
  } catch (err) {
    console.error('Retry payment error:', err)
    return { error: err.message }
  }
}

export async function cancelMandate(mandateId) {
  try {
    const { data, error } = await supabase.functions.invoke('gocardless-cancel-mandate', {
      body: { mandate_id: mandateId }
    })
    if (error) throw error
    return data
  } catch (err) {
    console.error('Cancel mandate error:', err)
    return { error: err.message }
  }
}

const gocardless = {
  createBillingRequest,
  createPayment,
  getMandate,
  getActiveMandates,
  getPayments,
  retryPayment,
  cancelMandate
}
export default gocardless