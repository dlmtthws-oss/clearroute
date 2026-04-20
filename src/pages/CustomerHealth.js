import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function CustomerHealth({ user }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [interventions, setInterventions] = useState([])
  const [stats, setStats] = useState({ critical: 0, high: 0, medium: 0, low: 0, valueAtRisk: 0 })

  const isWorker = user?.role === 'worker'

  useEffect(() => {
    if (!isWorker) {
      loadCustomerHealth()
    }
  }, [isWorker])

  async function loadCustomerHealth() {
    setLoading(true)
    const { data: scores } = await supabase
      .from('customer_churn_scores')
      .select('*, customers(name, address_line_1, postcode)')
      .order('churn_score', { ascending: false })
      .limit(100)

    if (scores) {
      setCustomers(scores.map(s => ({
        ...s,
        customerName: s.customers?.name,
        customerAddress: s.customers?.address_line_1,
        customerPostcode: s.customers?.postcode
      })))
    }
    setLoading(false)
  }

  async function calculateScores() {
    setGenerating(true)
    try {
      await supabase.functions.invoke('calculate-churn-scores')
      await loadCustomerHealth()
    } catch (err) {
      console.error('Calculation error:', err)
    } finally {
      setGenerating(false)
    }
  }

  async function loadInterventions(customerId) {
    const { data } = await supabase
      .from('customer_interventions')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
    setInterventions(data || [])
  }

  async function logIntervention(customerId, type, notes, outcome) {
    await supabase.from('customer_interventions').insert({
      customer_id: customerId,
      intervention_type: type,
      notes,
      outcome,
      created_by: user?.id
    })
    loadInterventions(customerId)
  }

  const filtered = customers.filter(c => {
    if (filter === 'all') return true
    return c.risk_level === filter
  })

  const statsData = {
    critical: customers.filter(c => c.risk_level === 'critical').length,
    high: customers.filter(c => c.risk_level === 'high').length,
    medium: customers.filter(c => c.risk_level === 'medium').length,
    low: customers.filter(c => c.risk_level === 'low').length,
    valueAtRisk: customers.filter(c => ['critical', 'high'].includes(c.risk_level))
      .reduce((sum, c) => sum + (c.outstanding_balance || 0), 0)
  }

  const getScoreColor = (score) => {
    if (score >= 0.75) return 'bg-red-500'
    if (score >= 0.50) return 'bg-orange-500'
    if (score >= 0.30) return 'bg-amber-500'
    return 'bg-green-500'
  }

  const getLevelBadge = (level) => {
    const styles = {
      critical: 'bg-red-100 text-red-700',
      high: 'bg-orange-100 text-orange-700',
      medium: 'bg-amber-100 text-amber-700',
      low: 'bg-green-100 text-green-700'
    }
    return styles[level] || 'bg-gray-100 text-gray-700'
  }

  if (isWorker) {
    return <div className="p-6 text-center text-gray-500">Customer health analytics are not available for field workers.</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Health</h1>
          <p className="text-gray-500">AI-powered churn prediction and retention</p>
        </div>
        {user?.role === 'admin' && (
          <button
            onClick={calculateScores}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? '⏳ Calculating...' : '🔄 Recalculate Scores'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-600">{statsData.critical}</div>
          <div className="text-sm text-red-600">Critical Risk</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-orange-600">{statsData.high}</div>
          <div className="text-sm text-orange-600">High Risk</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-amber-600">{statsData.medium}</div>
          <div className="text-sm text-amber-600">Medium Risk</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-600">{statsData.low}</div>
          <div className="text-sm text-green-600">Healthy</div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <span className="font-semibold text-amber-800">Value at risk: </span>
        <span className="text-amber-800">£{statsData.valueAtRisk.toLocaleString()}</span>
        <span className="text-amber-600 ml-2">(critical + high risk customers)</span>
      </div>

      <div className="flex gap-2 border-b">
        {['all', 'critical', 'high', 'medium'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium capitalize ${filter === f ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {f === 'all' ? 'All Customers' : f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Customer</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Risk Score</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Level</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Key Risk</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No customers in this category</td></tr>
            ) : filtered.map(cust => (
              <tr 
                key={cust.id} 
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => { setSelectedCustomer(cust); loadInterventions(cust.customer_id) }}
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{cust.customerName}</div>
                  <div className="text-sm text-gray-500">{cust.customerAddress}, {cust.customerPostcode}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${getScoreColor(cust.churn_score)}`} 
                        style={{ width: `${cust.churn_score * 100}%` }}
                      />
                    </div>
                    <span className="text-sm">{(cust.churn_score * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getLevelBadge(cust.risk_level)}`}>
                    {cust.risk_level}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {cust.risk_factors?.[0] || '-'}
                </td>
                <td className="px-4 py-3">
                  {cust.score_change ? (
                    <span className={cust.score_change > 0 ? 'text-red-600' : 'text-green-600'}>
                      {cust.score_change > 0 ? '↑' : '↓'} {Math.abs(cust.score_change * 100).toFixed(0)}%
                    </span>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50" onClick={() => setSelectedCustomer(null)}>
          <div className="w-[500px] bg-white h-full overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">{selectedCustomer.customerName}</h2>
              <button onClick={() => setSelectedCustomer(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-1 rounded text-sm font-medium ${getLevelBadge(selectedCustomer.risk_level)}`}>
                  {selectedCustomer.risk_level?.toUpperCase()}
                </span>
                <span className="text-2xl font-bold">{(selectedCustomer.churn_score * 100).toFixed(0)}%</span>
              </div>
              {selectedCustomer.ai_analysis && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                  <h4 className="font-medium text-blue-800 mb-2">AI Analysis</h4>
                  <p className="text-blue-700">{selectedCustomer.ai_analysis}</p>
                </div>
              )}
            </div>

            <div className="mb-6">
              <h4 className="font-medium text-gray-800 mb-3">Risk Factors</h4>
              <div className="space-y-2">
                {(selectedCustomer.risk_factors || []).map((factor, i) => (
                  <div key={i} className="flex items-center gap-2 text-gray-600">
                    <span>⚠️</span>
                    <span>{factor}</span>
                  </div>
                ))}
              </div>
            </div>

            {(selectedCustomer.suggested_actions?.length > 0) && (
              <div className="mb-6">
                <h4 className="font-medium text-gray-800 mb-3">Recommended Actions</h4>
                <div className="space-y-3">
                  {(selectedCustomer.suggested_actions || []).map((action, i) => (
                    <div key={i} className="p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium text-gray-800">{action.action}</div>
                      <div className="text-sm text-gray-600">{action.rationale}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-6">
              <h4 className="font-medium text-gray-800 mb-3">Log Intervention</h4>
              <div className="flex gap-2 flex-wrap">
                {['call_logged', 'email_sent', 'visit_scheduled', 'discount_offered', 'note_added'].map(type => (
                  <button
                    key={type}
                    onClick={() => logIntervention(selectedCustomer.customer_id, type, '', 'ongoing')}
                    className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
                  >
                    {type.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-medium text-gray-800 mb-3">Intervention History</h4>
              {interventions.length === 0 ? (
                <p className="text-gray-500 text-sm">No interventions logged</p>
              ) : (
                <div className="space-y-2">
                  {interventions.map(int => (
                    <div key={int.id} className="p-3 bg-gray-50 rounded text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{int.intervention_type?.replace('_', ' ')}</span>
                        <span className="text-gray-500 text-xs">
                          {new Date(int.created_at).toLocaleDateString('en-GB')}
                        </span>
                      </div>
                      {int.notes && <p className="text-gray-600 mt-1">{int.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}