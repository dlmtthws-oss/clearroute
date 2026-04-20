import { supabase } from './supabase'

export async function getXeroConnection(userId) {
  const { data, error } = await supabase
    .from('xero_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (error) return null
  return data
}

export async function syncCustomerToXero(customerId, userId) {
  const { data, error } = await supabase.functions.invoke('xero-sync-customer', {
    body: { customerId, userId }
  })

  if (error) throw error
  return data
}

export async function syncInvoiceToXero(invoiceId, userId) {
  const { data, error } = await supabase.functions.invoke('xero-sync-invoice', {
    body: { invoiceId, userId }
  })

  if (error) throw error
  return data
}

export async function syncExpenseToXero(expenseId, userId) {
  const { data, error } = await supabase.functions.invoke('xero-sync-expense', {
    body: { expenseId, userId }
  })

  if (error) throw error
  return data
}

export async function syncPaymentToXero(paymentId, userId) {
  const { data, error } = await supabase.functions.invoke('xero-sync-payment', {
    body: { paymentId, userId }
  })

  if (error) throw error
  return data
}

export async function fullSyncXero(userId, entityType = 'all') {
  const { data, error } = await supabase.functions.invoke('xero-full-sync', {
    body: { userId, entityType }
  })

  if (error) throw error
  return data
}

export async function startXeroAuth(userId) {
  const { data, error } = await supabase.functions.invoke('xero-auth-start', {
    body: { userId }
  })

  if (error) throw error
  return data
}

export function getXeroSyncStatusBadge(invoice) {
  if (!invoice.xero_sync_status || invoice.xero_sync_status === 'not_synced') {
    return { label: 'Not synced', color: 'bg-gray-100 text-gray-700' }
  }
  if (invoice.xero_sync_status === 'synced') {
    return { label: 'Synced to Xero', color: 'bg-green-100 text-green-700' }
  }
  if (invoice.xero_sync_status === 'error') {
    return { label: 'Sync error', color: 'bg-red-100 text-red-700' }
  }
  return { label: 'Unknown', color: 'bg-gray-100 text-gray-700' }
}

export function formatXeroSyncTime(timestamp) {
  if (!timestamp) return 'Never'
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor(diff / (1000 * 60))

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return date.toLocaleDateString()
}