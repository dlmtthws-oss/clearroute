import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AnomalyManagement({ onViewInvoice }) {
  const [anomalies, setAnomalies] = useState([])
  const [thresholds, setThresholds] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('anomalies')

  useEffect(() => {
    fetchAnomalies()
    fetchThresholds()
  }, [])

  const fetchAnomalies = async () => {
    const { data } = await supabase
      .from('risk_events')
      .select('*, invoices(invoice_number, customers(name))')
      .order('created_at', { ascending: false })
      .limit(100)
    
    setAnomalies(data || [])
    setLoading(false)
  }

  const fetchThresholds = async () => {
    const { data } = await supabase
      .from('risk_thresholds')
      .select('*')
      .order('threshold_type')
    
    setThresholds(data || [])
  }

  const handleAnomalyAction = async (id, action, resolutionNote = '') => {
    const updates = {
      status: action,
      reviewed_at: new Date().toISOString()
    }
    
    if (resolutionNote) {
      updates.resolution_note = resolutionNote
    }
    
    await supabase
      .from('risk_events')
      .update(updates)
      .eq('id', id)
    
    fetchAnomalies()
  }

  const handleThresholdUpdate = async (id, value) => {
    await supabase
      .from('risk_thresholds')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('id', id)
    
    fetchThresholds()
  }

  const getSeverityClasses = (severity) => {
    switch (severity) {
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      default:
        return 'bg-blue-100 text-blue-800 border-blue-200'
    }
  }

  const getTypeLabel = (type) => {
    const labels = {
      duplicate_suspected: 'Duplicate Detection',
      amount_unusual: 'Unusual Amount',
      pricing_inconsistency: 'Pricing Inconsistency',
      vat_calculation_error: 'VAT Calculation Error',
      missing_vat: 'Missing VAT',
      unusual_payment_terms: 'Unusual Payment Terms',
      duplicate_line_item: 'Duplicate Line Item',
      customer_spend_change: 'Customer Spend Change'
    }
    return labels[type] || type
  }

  const AnomalyRow = ({ anomaly }) => (
    <div className="p-4 border-b hover:bg-gray-50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`px-2 py-1 rounded text-xs font-medium border flex-shrink-0 ${getSeverityClasses(anomaly.severity)}`}>
            {anomaly.severity}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{anomaly.title}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
                {getTypeLabel(anomaly.anomaly_type)}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              {anomaly.invoices?.invoice_number} • {anomaly.invoices?.customers?.name || 'Unknown'}
            </div>
            <div className="text-sm text-gray-600 mt-1">{anomaly.description}</div>
            {anomaly.ai_reasoning && (
              <div className="text-sm text-gray-500 mt-1 italic">AI: {anomaly.ai_reasoning}</div>
            )}
            {anomaly.resolution_note && (
              <div className="text-sm mt-2 p-2 bg-green-50 rounded">
                <strong>Resolved:</strong> {anomaly.resolution_note}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full ${
            anomaly.status === 'open' ? 'bg-red-100 text-red-800' :
            anomaly.status === 'resolved' ? 'bg-green-100 text-green-800' :
            anomaly.status === 'reviewed' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {anomaly.status}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(anomaly.created_at).toLocaleDateString()}
          </span>
          
          {anomaly.status === 'open' && (
            <div className="flex gap-1">
              <button
                onClick={() => handleAnomalyAction(anomaly.id, 'resolved')}
                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
              >
                Resolve
              </button>
              <button
                onClick={() => handleAnomalyAction(anomaly.id, 'dismissed')}
                className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Dismiss
              </button>
            </div>
          )}
          
          {anomaly.invoice_id && (
            <button
              onClick={() => onViewInvoice(anomaly.invoice_id)}
              className="text-xs text-blue-600 hover:underline"
            >
              View Invoice →
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  const openCount = anomalies.filter(a => a.status === 'open').length

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('anomalies')}
              className={`pb-2 border-b-2 ${
                activeTab === 'anomalies'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500'
              }`}
            >
              Anomalies ({anomalies.length})
            </button>
            <button
              onClick={() => setActiveTab('thresholds')}
              className={`pb-2 border-b-2 ${
                activeTab === 'thresholds'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500'
              }`}
            >
              Thresholds
            </button>
          </div>
          
          {activeTab === 'anomalies' && openCount > 0 && (
            <span className="text-sm text-red-600">
              {openCount} open issue{openCount !== 1 ? 's' : ''} require attention
            </span>
          )}
        </div>

        {activeTab === 'anomalies' ? (
          <div>
            {anomalies.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No anomalies detected yet. Anomalies will appear here when invoices are processed.
              </div>
            ) : (
              <div>
                {anomalies.map(anomaly => (
                  <AnomalyRow key={anomaly.id} anomaly={anomaly} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6">
            <div className="space-y-4">
              {thresholds.map(threshold => (
                <div key={threshold.id} className="flex items-center justify-between py-2 border-b">
                  <div>
                    <div className="font-medium">{threshold.threshold_type}</div>
                    <div className="text-sm text-gray-500">
                      {threshold.threshold_type === 'duplicate_days_window' && 'Days window for duplicate detection'}
                      {threshold.threshold_type === 'amount_high_multiplier' && 'Multiplier for high amount warning'}
                      {threshold.threshold_type === 'amount_low_multiplier' && 'Multiplier for low amount warning'}
                      {threshold.threshold_type === 'price_variance_percent' && 'Percentage variance for price alerts'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={threshold.value}
                      onChange={(e) => handleThresholdUpdate(threshold.id, Number(e.target.value))}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                      step={threshold.threshold_type.includes('percent') ? 1 : 0.1}
                    />
                    <label className="text-sm text-gray-500">
                      {threshold.threshold_type.includes('percent') ? '%' : 'x'}
                    </label>
                    <span className={`text-xs px-2 py-1 rounded ${
                      threshold.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {threshold.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}