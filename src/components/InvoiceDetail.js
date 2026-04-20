import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function InvoiceDetail({ invoiceId, onEdit, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [anomalies, setAnomalies] = useState([])
  const [customer, setCustomer] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (invoiceId) {
      fetchInvoice()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  const fetchInvoice = async () => {
    setLoading(true)
    
    const { data: inv } = await supabase
      .from('invoices')
      .select('*, customers(*)')
      .eq('id', invoiceId)
      .single()
    
    if (inv) {
      setInvoice(inv)
      setCustomer(inv.customers)
      
      const { data: itemsData } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('sort_order')
      
      setItems(itemsData || [])
      
      const { data: anomaliesData } = await supabase
        .from('risk_events')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false })
      
      setAnomalies(anomaliesData || [])
    }
    
    setLoading(false)
  }

  const handleStatusChange = async (anomalyId, newStatus, resolutionNote = '') => {
    await supabase
      .from('risk_events')
      .update({ 
        status: newStatus, 
        reviewed_at: new Date().toISOString(),
        resolution_note: resolutionNote
      })
      .eq('id', anomalyId)
    
    fetchInvoice()
  }

  const getSeverityClasses = (severity) => {
    switch (severity) {
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800'
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800'
      default:
        return 'bg-blue-50 border-blue-200 text-blue-800'
    }
  }

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'error':
        return (
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        )
      case 'warning':
        return (
          <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )
      default:
        return (
          <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  if (!invoice) {
    return <div className="text-center py-8 text-gray-500">Invoice not found</div>
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{invoice.invoice_number}</h2>
            <p className="text-sm text-gray-500">
              {customer?.name || 'No customer'} • {invoice.issue_date}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onEdit(invoiceId)}
              className="px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800"
            >
              Edit Invoice
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <span className="text-sm text-gray-500">Status</span>
              <p className="font-medium capitalize">{invoice.status}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Payment Terms</span>
              <p className="font-medium">{invoice.payment_terms}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Subtotal</span>
              <p className="font-medium">£{invoice.subtotal?.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Total</span>
              <p className="font-medium text-lg">£{invoice.total?.toFixed(2)}</p>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Line Items</h3>
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-2">Description</th>
                  <th className="pb-2 w-20 text-center">Qty</th>
                  <th className="pb-2 w-28 text-right">Unit Price</th>
                  <th className="pb-2 w-28 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-2">{item.description}</td>
                    <td className="py-2 text-center">{item.quantity}</td>
                    <td className="py-2 text-right">£{item.unit_price?.toFixed(2)}</td>
                    <td className="py-2 text-right">£{item.line_total?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invoice.notes && (
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-sm font-medium text-gray-700 mb-1">Notes</h3>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Detected Issues</h3>
            <span className="text-sm text-gray-500">
              {anomalies.filter(a => a.status === 'open').length} open
            </span>
          </div>
        </div>

        {anomalies.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No issues detected for this invoice
          </div>
        ) : (
          <div className="divide-y">
            {anomalies.map((anomaly) => (
              <div key={anomaly.id} className={`p-4 ${getSeverityClasses(anomaly.severity)}`}>
                <div className="flex items-start gap-3">
                  {getSeverityIcon(anomaly.severity)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{anomaly.title}</h4>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        anomaly.status === 'open' ? 'bg-white' :
                        anomaly.status === 'resolved' ? 'bg-green-100 text-green-800' :
                        anomaly.status === 'dismissed' ? 'bg-gray-100 text-gray-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {anomaly.status}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{anomaly.description}</p>
                    {anomaly.ai_reasoning && (
                      <p className="text-sm mt-2 opacity-75">AI: {anomaly.ai_reasoning}</p>
                    )}
                    {anomaly.suggested_action && (
                      <p className="text-sm mt-1 font-medium">Suggested: {anomaly.suggested_action}</p>
                    )}
                    
                    {anomaly.status === 'open' && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handleStatusChange(anomaly.id, 'resolved')}
                          className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => handleStatusChange(anomaly.id, 'dismissed')}
                          className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                    
                    {anomaly.resolution_note && (
                      <div className="mt-2 text-sm bg-white bg-opacity-50 p-2 rounded">
                        <strong>Resolution:</strong> {anomaly.resolution_note}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}