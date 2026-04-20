import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AnomalyManagement({ user }) {
  const [anomalies, setAnomalies] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [stats, setStats] = useState({ error: 0, warning: 0, info: 0 })

  const isWorker = user?.role === 'worker'
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!isWorker) {
      loadAnomalies()
    }
  }, [isWorker, filter])

  async function loadAnomalies() {
    setLoading(true)
    let query = supabase
      .from('invoice_anomalies')
      .select('*, invoices(invoice_number, customers(name, total))')
      .order('created_at', { ascending: false })

    if (filter === 'open') {
      query = query.eq('status', 'open')
    } else if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data } = await query.limit(100)
    if (data) {
      setAnomalies(data.map(a => ({
        ...a,
        invoiceNumber: a.invoices?.invoice_number,
        customerName: a.invoices?.customers?.name,
        invoiceTotal: a.invoices?.total
      })))
    }
    setLoading(false)
  }

  async function runChecks(invoiceId) {
    try {
      await supabase.functions.invoke('check-invoice-anomalies', {
        body: { invoice_id: invoiceId }
      })
      loadAnomalies()
    } catch (err) {
      console.error('Check error:', err)
    }
  }

  async function resolveAnomaly(anomalyId, status, note) {
    await supabase.from('invoice_anomalies').update({
      status,
      resolved_note: note,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString()
    }).eq('id', anomalyId)
    loadAnomalies()
  }

  async function resolveAll(status) {
    const ids = anomalies.map(a => a.id)
    if (ids.length === 0) return
    await supabase.from('invoice_anomalies').update({
      status,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString()
    }).in('id', ids)
    loadAnomalies()
  }

  const getSeverityIcon = (severity) => {
    if (severity === 'error') return '🚫'
    if (severity === 'warning') return '⚠️'
    return 'ℹ️'
  }

  const getSeverityStyle = (severity) => {
    if (severity === 'error') return 'bg-red-100 text-red-700 border-red-300'
    if (severity === 'warning') return 'bg-amber-100 text-amber-700 border-amber-300'
    return 'bg-blue-100 text-blue-700 border-blue-300'
  }

  if (isWorker) {
    return <div className="p-6 text-center text-gray-500">Anomaly management is not available for field workers.</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoice Anomalies</h1>
          <p className="text-gray-500">AI-powered invoice checks</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-600">
            {anomalies.filter(a => a.severity === 'error' && a.status === 'open').length}
          </div>
          <div className="text-sm text-red-600">Errors</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-amber-600">
            {anomalies.filter(a => a.severity === 'warning' && a.status === 'open').length}
          </div>
          <div className="text-sm text-amber-600">Warnings</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-600">
            {anomalies.filter(a => a.severity === 'info' && a.status === 'open').length}
          </div>
          <div className="text-sm text-blue-600">Info</div>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        {['open', 'reviewed', 'resolved', 'all'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium capitalize ${filter === f ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {f === 'open' ? 'Open Anomalies' : f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Severity</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Invoice</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Description</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center">Loading...</td></tr>
            ) : anomalies.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No anomalies found</td></tr>
            ) : anomalies.map(anom => (
              <tr key={anom.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getSeverityStyle(anom.severity)}`}>
                    {getSeverityIcon(anom.severity)} {anom.severity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{anom.invoiceNumber}</div>
                  <div className="text-sm text-gray-500">{anom.customerName}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm">{anom.anomaly_type.replace('_', ' ')}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm">{anom.title}</div>
                  <div className="text-xs text-gray-500">{anom.description?.slice(0, 80)}</div>
                </td>
                <td className="px-4 py-3">
                  {anom.status === 'open' ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => resolveAnomaly(anom.id, 'reviewed', '')}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Mark Reviewed
                      </button>
                      <button
                        onClick={() => resolveAnomaly(anom.id, 'dismissed', '')}
                        className="text-gray-600 hover:text-gray-800 text-sm"
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">{anom.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}