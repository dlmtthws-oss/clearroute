import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import AIQuickStart from './AIQuickStart'
import LineItemAssistant from './LineItemAssistant'
import PreSendReviewModal from './PreSendReviewModal'

const initialInvoice = {
  invoice_number: '',
  customer_id: '',
  issue_date: new Date().toISOString().split('T')[0],
  due_date: '',
  payment_terms: 'Net 30',
  vat_rate: 0.20,
  notes: '',
  items: [{ description: '', quantity: 1, unit_price: 0, vat_rate: 0.20 }]
}

export default function InvoiceBuilder({ invoiceId, onSave, onCancel }) {
  const [invoice, setInvoice] = useState(initialInvoice)
  const [customers, setCustomers] = useState([])
  const [anomalies, setAnomalies] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [showAIQuickStart, setShowAIQuickStart] = useState(false)
  const [showLineAssistant, setShowLineAssistant] = useState(false)
  const [showPreSendReview, setShowPreSendReview] = useState(false)
  const [invoiceIdForReview, setInvoiceIdForReview] = useState(null)

  useEffect(() => {
    fetchCustomers()
    if (invoiceId) {
      fetchInvoice(invoiceId)
    } else {
      generateInvoiceNumber()
    }
  }, [invoiceId])

  const fetchCustomers = async () => {
    const { data } = await supabase.from('customers').select('*').order('name')
    if (data) setCustomers(data)
  }

  const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear()
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number')
      .like('invoice_number', `INV-${year}%`)
      .order('invoice_number', { ascending: false })
      .limit(1)
    
    let num = 1
    if (data && data[0]) {
      const last = parseInt(data[0].invoice_number.split('-')[1] || '0')
      num = last + 1
    }
    setInvoice(prev => ({ ...prev, invoice_number: `INV-${year}-${String(num).padStart(4, '0')` }))
  }

  const fetchInvoice = async (id) => {
    setLoading(true)
    const { data: inv } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', id)
      .single()
    
    if (inv) {
      setInvoice({
        ...inv,
        items: inv.invoice_items || [{ description: '', quantity: 1, unit_price: 0, vat_rate: 0.20 }]
      })
      fetchAnomalies(id)
    }
    setLoading(false)
  }

  const fetchAnomalies = async (id) => {
    const { data } = await supabase
      .from('risk_events')
      .select('*')
      .eq('invoice_id', id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    
    if (data) setAnomalies(data)
  }

  const runAnomalyCheck = useCallback(async () => {
    if (!invoiceId) return
    setChecking(true)
    
    try {
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
      const response = await fetch(supabaseUrl + '/functions/v1/check-invoice-anomalies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + supabaseKey,
        },
        body: JSON.stringify({ invoice_id: invoiceId })
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.anomalies) {
          setAnomalies(result.anomalies)
        }
      }
    } catch (err) {
      console.error('Anomaly check failed:', err)
    }
    
    setChecking(false)
  }, [invoiceId])

  const calculateTotals = () => {
    const subtotal = invoice.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
    const itemsVat = invoice.items.reduce((sum, item) => sum + (item.quantity * item.unit_price * item.vat_rate), 0)
    const vatAmount = invoice.vat_rate > 0 ? subtotal * invoice.vat_rate : itemsVat
    return { subtotal, vatAmount, total: subtotal + vatAmount }
  }

  const handleItemChange = (index, field, value) => {
    const newItems = [...invoice.items]
    newItems[index] = { ...newItems[index], [field]: field === 'description' ? value : Number(value) }
    setInvoice(prev => ({ ...prev, items: newItems }))
  }

  const addItem = () => {
    setInvoice(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: 1, unit_price: 0, vat_rate: prev.vat_rate }]
    }))
  }

  const removeItem = (index) => {
    if (invoice.items.length > 1) {
      const newItems = invoice.items.filter((_, i) => i !== index)
      setInvoice(prev => ({ ...prev, items: newItems }))
    }
  }

  const handleApplyAIItems = useCallback((items) => {
    if (items && items.length > 0) {
      const validItems = items.filter(item => item.description)
      if (validItems.length > 0) {
        setInvoice(prev => ({
          ...prev,
          items: validItems.map(item => ({
            description: item.description,
            quantity: item.quantity || 1,
            unit_price: item.unit_price || 0,
            vat_rate: item.vat_rate ?? 0.20
          }))
        }))
      }
    }
    setShowAIQuickStart(false)
  }, [])

  const handleApplyLineItem = useCallback((item) => {
    if (item && item.description) {
      setInvoice(prev => ({
        ...prev,
        items: [...prev.items, {
          description: item.description,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 50,
          vat_rate: item.vat_rate ?? 0.20
        }]
      }))
    }
  }, [])

  const handleGenerateNotes = useCallback(async () => {
    if (!invoice.customer_id) return
    
    try {
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
      const response = await fetch(
        supabaseUrl + '/functions/v1/invoice-writing-assistant',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + supabaseKey,
          },
          body: JSON.stringify({
            action: 'generate-notes',
            customer_id: invoice.customer_id
          })
        }
      )

      if (response.ok) {
        const result = await response.json()
        if (result.notes) {
          setInvoice(prev => ({ ...prev, notes: result.notes }))
        }
      }
    } catch (err) {
      console.error('Failed to generate notes:', err)
    }
  }, [invoice.customer_id])

  const openPreSendReview = useCallback(async () => {
    setSaving(true)
    
    const { subtotal, vatAmount, total } = calculateTotals()
    
    const invoiceData = {
      invoice_number: invoice.invoice_number,
      customer_id: invoice.customer_id || null,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date || null,
      subtotal,
      vat_amount: vatAmount,
      total,
      vat_rate: invoice.vat_rate,
      payment_terms: invoice.payment_terms,
      notes: invoice.notes || null,
      status: 'draft'
    }

    let invId = invoiceId

    if (invoiceId) {
      await supabase.from('invoices').update(invoiceData).eq('id', invoiceId)
    } else {
      const { data } = await supabase.from('invoices').insert(invoiceData).select().single()
      if (data) {
        invId = data.id
        if (onSave) onSave(data.id)
      }
    }

    if (invId) {
      await supabase.from('invoice_items').delete().eq('invoice_id', invId)
      
      const itemsData = invoice.items.map((item, idx) => ({
        invoice_id: invId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        tax_amount: item.quantity * item.unit_price * item.vat_rate,
        line_total: item.quantity * item.unit_price,
        sort_order: idx
      }))
      
      await supabase.from('invoice_items').insert(itemsData)
      setInvoiceIdForReview(invId)
      setShowPreSendReview(true)
    }

    setSaving(false)
  }, [invoice, invoiceId, calculateTotals])

  const handleSendInvoice = useCallback(async () => {
    if (!invoiceIdForReview) return
    setSaving(true)

    await supabase
      .from('invoices')
      .update({ status: 'sent' })
      .eq('id', invoiceIdForReview)

    setSaving(false)
    setShowPreSendReview(false)
    if (onSave) onSave(invoiceIdForReview)
  }, [invoiceIdForReview])

  const handleReviewInvoice = useCallback(() => {
    setShowPreSendReview(false)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    
    const { subtotal, vatAmount, total } = calculateTotals()
    
    const invoiceData = {
      invoice_number: invoice.invoice_number,
      customer_id: invoice.customer_id || null,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date || null,
      subtotal,
      vat_amount: vatAmount,
      total,
      vat_rate: invoice.vat_rate,
      payment_terms: invoice.payment_terms,
      notes: invoice.notes || null,
      status: 'draft'
    }

    let invId = invoiceId

    if (invoiceId) {
      const { error } = await supabase.from('invoices').update(invoiceData).eq('id', invoiceId)
      if (error) {
        console.error('Update error:', error)
        setSaving(false)
        return
      }
    } else {
      const { data, error } = await supabase.from('invoices').insert(invoiceData).select().single()
      if (error) {
        console.error('Insert error:', error)
        setSaving(false)
        return
      }
      invId = data.id
    }

    // Update items
    await supabase.from('invoice_items').delete().eq('invoice_id', invId)
    
    const itemsData = invoice.items.map((item, idx) => ({
      invoice_id: invId,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      tax_amount: item.quantity * item.unit_price * item.vat_rate,
      line_total: item.quantity * item.unit_price,
      sort_order: idx
    }))
    
    await supabase.from('invoice_items').insert(itemsData)

    // Run anomaly check
    try {
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
      await fetch(supabaseUrl + '/functions/v1/check-invoice-anomalies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + supabaseKey,
        },
        body: JSON.stringify({ invoice_id: invId })
      })
    } catch (err) {
      console.error('Anomaly check failed:', err)
    }

    setSaving(false)
    if (onSave) onSave(invId)
  }

  const { subtotal, vatAmount, total } = calculateTotals()
  const errorCount = anomalies.filter(a => a.severity === 'error').length
  const warningCount = anomalies.filter(a => a.severity === 'warning').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label="Loading invoice">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900" id="invoice-form-title">
            {invoiceId ? 'Edit Invoice' : 'New Invoice'}
          </h2>
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                {errorCount} Error{errorCount > 1 ? 's' : ''}
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                {warningCount} Warning{warningCount > 1 ? 's' : ''}
              </span>
            )}
            {checking && (
              <span className="text-sm text-gray-500">Checking...</span>
            )}
          </div>
        </div>
      </div>

      {anomalies.length > 0 && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <div className="space-y-2">
            {anomalies.map(function(anomaly) {
              const bgClass = anomaly.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
              return (
                <div key={anomaly.id} className={'flex items-start gap-2 p-2 rounded text-sm ' + bgClass}>
                {anomaly.severity === 'error' ? (
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                )}
                <div>
                  <span className="font-medium">{anomaly.title}</span>
                  <span className="ml-1">- {anomaly.description}</span>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Invoice Number
            </label>
            <input
              type="text"
              value={invoice.invoice_number}
              onChange={(e) => setInvoice(prev => ({ ...prev, invoice_number: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer
            </label>
            <select
              value={invoice.customer_id}
              onChange={(e) => setInvoice(prev => ({ ...prev, customer_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              <option value="">Select customer...</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Issue Date
            </label>
            <input
              type="date"
              value={invoice.issue_date}
              onChange={(e) => setInvoice(prev => ({ ...prev, issue_date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Due Date
            </label>
            <input
              type="date"
              value={invoice.due_date || ''}
              onChange={(e) => setInvoice(prev => ({ ...prev, due_date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Terms
            </label>
            <select
              value={invoice.payment_terms}
              onChange={(e) => setInvoice(prev => ({ ...prev, payment_terms: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              <option value="Due on Receipt">Due on Receipt</option>
              <option value="Net 14">Net 14</option>
              <option value="Net 30">Net 30</option>
              <option value="Net 60">Net 60</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              VAT Rate
            </label>
            <select
              value={invoice.vat_rate}
              onChange={(e) => setInvoice(prev => ({ ...prev, vat_rate: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              <option value="0">0%</option>
              <option value="0.20">20%</option>
              <option value="0.05">5%</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700">Line Items</h3>
            <div className="flex gap-2">
              {invoice.customer_id && (
                <button
                  type="button"
                  onClick={() => setShowAIQuickStart(true)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  AI Quick Start
                </button>
              )}
              <button
                type="button"
                onClick={addItem}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                + Add Item
              </button>
            </div>
          </div>

          {showAIQuickStart && (
            <div className="mb-4">
              <AIQuickStart
                customerId={invoice.customer_id}
                onSelectItems={handleApplyAIItems}
                onCancel={() => setShowAIQuickStart(false)}
              />
            </div>
          )}
          
          <div className="space-y-2">
            {invoice.items.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                  {index === 0 && invoice.customer_id && (
                    <button
                      type="button"
                      onClick={() => setShowLineAssistant(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 whitespace-nowrap"
                    >
                      AI Assist
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                  className="w-16 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
                <input
                  type="number"
                  placeholder="Price"
                  value={item.unit_price}
                  onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="p-2 text-gray-400 hover:text-red-600"
                  disabled={invoice.items.length === 1}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M7 7h10" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">£{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">VAT ({(invoice.vat_rate * 100).toFixed(0)}%)</span>
                <span className="font-medium">£{vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-semibold border-t pt-2">
                <span>Total</span>
                <span>£{total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              Notes
            </label>
            {invoice.customer_id && (
              <button
                type="button"
                onClick={handleGenerateNotes}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Generate with AI
              </button>
            )}
          </div>
          <textarea
            value={invoice.notes || ''}
            onChange={(e) => setInvoice(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
          />
        </div>
      </div>

      <div className="px-6 py-4 bg-gray-50 border-t flex justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            aria-busy={saving}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </span>
            ) : 'Save Draft'}
          </button>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          {invoice.customer_id && invoice.items.length > 0 && invoice.items[0].description && (
            <button
              type="button"
              onClick={openPreSendReview}
              disabled={saving}
              aria-busy={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Preparing...' : 'Prepare to Send'}
            </button>
          )}
        </div>
      </div>

      {showLineAssistant && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-4 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-medium">Line Item Assistant</h3>
              <button
                type="button"
                onClick={() => setShowLineAssistant(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <LineItemAssistant
              customerId={invoice.customer_id}
              onApplyItem={(item) => {
                handleApplyLineItem(item)
                setShowLineAssistant(false)
              }}
            />
          </div>
        </div>
      )}

      {showPreSendReview && invoiceIdForReview && (
        <PreSendReviewModal
          invoiceId={invoiceIdForReview}
          onSend={handleSendInvoice}
          onReview={handleReviewInvoice}
          onCancel={() => setShowPreSendReview(false)}
        />
      )}
    </div>
  )
}