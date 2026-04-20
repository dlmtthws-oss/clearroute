import { supabase } from './supabase'

export async function getQuickBooksConnection(userId) {
  const { data, error } = await supabase
    .from('quickbooks_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (error) return null
  return data
}

export async function syncCustomerToQBO(customerId, userId) {
  const { data, error } = await supabase.functions.invoke('qbo-sync-customer', {
    body: { customerId, userId }
  })

  if (error) throw error
  return data
}

export async function syncInvoiceToQBO(invoiceId, userId) {
  const { data, error } = await supabase.functions.invoke('qbo-sync-invoice', {
    body: { invoiceId, userId }
  })

  if (error) throw error
  return data
}

export async function syncExpenseToQBO(expenseId, userId) {
  const { data, error } = await supabase.functions.invoke('qbo-sync-expense', {
    body: { expenseId, userId }
  })

  if (error) throw error
  return data
}

export async function syncPaymentToQBO(paymentId, userId) {
  const { data, error } = await supabase.functions.invoke('qbo-sync-payment', {
    body: { paymentId, userId }
  })

  if (error) throw error
  return data
}

export async function fullSyncQBO(userId, entityType = 'all') {
  const { data, error } = await supabase.functions.invoke('qbo-full-sync', {
    body: { userId, entityType }
  })

  if (error) throw error
  return data
}

export async function startQuickBooksAuth(userId) {
  const { data, error } = await supabase.functions.invoke('qbo-auth-start', {
    body: { userId }
  })

  if (error) throw error
  
  if (data?.authUrl) {
    const redirectUrl = `${window.location.origin}/settings/quickbooks-callback`
    const encodedUserId = btoa(JSON.stringify({ userId }))
    return `${data.authUrl}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(encodedUserId)}`
  }
  
  return data
}

export async function getQBOAccounts(userId) {
  const { data, error } = await supabase.functions.invoke('qbo-get-accounts', {
    body: { userId }
  })

  if (error) throw error
  return data
}

export function getQBOSyncStatusBadge(invoice) {
  if (!invoice.qbo_sync_status || invoice.qbo_sync_status === 'not_synced') {
    return { label: 'Not synced', color: 'bg-gray-100 text-gray-700' }
  }
  if (invoice.qbo_sync_status === 'synced') {
    return { label: 'Synced to QBO', color: 'bg-green-100 text-green-700' }
  }
  if (invoice.qbo_sync_status === 'error') {
    return { label: 'Sync error', color: 'bg-red-100 text-red-700' }
  }
  return { label: 'Unknown', color: 'bg-gray-100 text-gray-700' }
}

export function formatQBOSyncTime(timestamp) {
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