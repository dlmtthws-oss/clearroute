import { supabase } from './supabase'

const SENSITIVE_FIELDS = [
  'password',
  'password_hash',
  'access_token',
  'refresh_token',
  'api_key',
  'secret',
  ' mandate_id',
  'mandateId',
  'card',
  'cvv',
  'token'
]

export async function logAuditEvent(
  action,
  entityType,
  entityId = null,
  entityReference = null,
  oldValues = null,
  newValues = null
) {
  try {
    // Remove sensitive fields
    const cleanOld = oldValues ? removeSensitiveFields(oldValues) : null
    const cleanNew = newValues ? removeSensitiveFields(newValues) : null

    await supabase.rpc('log_audit_event', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_entity_reference: entityReference,
      p_old_values: JSON.stringify(cleanOld),
      p_new_values: JSON.stringify(cleanNew)
    })
  } catch (error) {
    console.error('Audit log failed:', error)
  }
}

function removeSensitiveFields(obj) {
  if (!obj) return null
  
  const cleaned = { ...obj }
  
  for (const key of Object.keys(cleaned)) {
    const lowerKey = key.toLowerCase()
    for (const sensitive of SENSITIVE_FIELDS) {
      if (lowerKey.includes(sensitive.toLowerCase())) {
        delete cleaned[key]
        break
      }
    }
  }
  
  return cleaned
}

// Helper to generate diff summary
export function generateDiffSummary(oldValues, newValues) {
  if (!oldValues && !newValues) return null
  
  const changes = []
  const allKeys = new Set([
    ...Object.keys(oldValues || {}),
    ...Object.keys(newValues || {})
  ])
  
  for (const key of allKeys) {
    const oldVal = oldValues?.[key]
    const newVal = newValues?.[key]
    
    if (oldVal !== newVal) {
      changes.push({
        field: key,
        before: oldVal,
        after: newVal
      })
    }
  }
  
  return changes.length > 0 ? changes : null
}

export const AUDIT_ACTIONS = {
  // Invoice actions
  INVOICE_CREATED: 'invoice.created',
  INVOICE_UPDATED: 'invoice.updated',
  INVOICE_DELETED: 'invoice.deleted',
  INVOICE_SENT: 'invoice.sent',
  INVOICE_STATUS_CHANGED: 'invoice.status_changed',
  INVOICE_PAYMENT_RECORDED: 'invoice.payment_recorded',
  INVOICE_PDF_DOWNLOADED: 'invoice.pdf_downloaded',

  // Payment actions
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_DELETED: 'payment.deleted',
  PAYMENT_GOCARDLESS_INITIATED: 'payment.gocardless_initiated',
  PAYMENT_GOCARDLESS_CONFIRMED: 'payment.gocardless_confirmed',
  PAYMENT_GOCARDLESS_FAILED: 'payment.gocardless_failed',

  // Customer actions
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',
  CUSTOMER_IMPORTED: 'customer.imported',
  CUSTOMER_PORTAL_LINK_REGENERATED: 'customer.portal_link_regenerated',

  // Route actions
  ROUTE_CREATED: 'route.created',
  ROUTE_UPDATED: 'route.updated',
  ROUTE_DELETED: 'route.deleted',
  ROUTE_STARTED: 'route.started',
  ROUTE_COMPLETED: 'route.completed',
  ROUTE_ASSIGNED: 'route.assigned',

  // Expense actions
  EXPENSE_CREATED: 'expense.created',
  EXPENSE_UPDATED: 'expense.updated',
  EXPENSE_DELETED: 'expense.deleted',

  // Quote actions
  QUOTE_CREATED: 'quote.created',
  QUOTE_SENT: 'quote.sent',
  QUOTE_ACCEPTED: 'quote.accepted',
  QUOTE_DECLINED: 'quote.declined',
  QUOTE_CONVERTED_TO_INVOICE: 'quote.converted_to_invoice',

  // Settings actions
  SETTINGS_COMPANY_UPDATED: 'settings.company_updated',
  SETTINGS_LOGO_UPLOADED: 'settings.logo_uploaded',
  SETTINGS_EMAIL_TEMPLATE_UPDATED: 'settings.email_template_updated',
  SETTINGS_HMRC_CONNECTED: 'settings.hmrc_connected',
  SETTINGS_HMRC_DISCONNECTED: 'settings.hmrc_disconnected',
  SETTINGS_GOCARDLESS_CONNECTED: 'settings.gocardless_connected',

  // VAT actions
  VAT_RETURN_CALCULATED: 'vat_return.calculated',
  VAT_RETURN_SUBMITTED: 'vat_return.submitted',
  VAT_RETURN_VIEWED: 'vat_return.viewed',

  // User actions
  USER_INVITED: 'user.invited',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DEACTIVATED: 'user.deactivated',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',

  // Recurring actions
  RECURRING_CREATED: 'recurring.created',
  RECURRING_UPDATED: 'recurring.updated',
  RECURRING_PAUSED: 'recurring.paused',
  RECURRING_DELETED: 'recurring.deleted',
  RECURRING_GENERATED: 'recurring.generated',
  RECURRING_RUN_MANUALLY: 'recurring.run_manually'
}

export const ENTITY_TYPES = [
  'invoice',
  'payment',
  'customer',
  'route',
  'expense',
  'quote',
  'user',
  'settings',
  'vat_return',
  'gocardless',
  'recurring_invoice'
]