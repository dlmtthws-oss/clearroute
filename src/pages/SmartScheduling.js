import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'

export default function SmartScheduling({ user }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [overdue, setOverdue] = useState([])
  const [workload, setWorkload] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [view, setView] = useState('suggestions')

  const isWorker = user?.role === 'worker'
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!isWorker) {
      loadData()
    }
  }, [isWorker])

  async function loadData() {
    setLoading(true)
    const [{ data: suggData }, { data: overdueData }, { data: workloadData }] = await Promise.all([
      supabase.from('scheduling_suggestions').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.rpc('get_overdue_customers', { days_threshold: 21 }),
      supabase.rpc('get_worker_workload')
    ])
    setSuggestions(suggData || [])
    setOverdue(overdueData || [])
    setWorkload(workloadData || [])
    setLoading(false)
  }

  async function generateSuggestions() {
    setGenerating(true)
    try {
      await supabase.functions.invoke('generate-scheduling-suggestions')
      await loadData()
    } catch (err) {
      console.error('Generation error:', err)
    } finally {
      setGenerating(false)
    }
  }

  async function dismissSuggestion(id, reason) {
    await supabase.from('scheduling_suggestions').update({
      status: 'dismissed',
      dismissed_at: new Date().toISOString(),
      dismissed_reason: reason
    }).eq('id', id)
    loadData()
  }

  async function acceptSuggestion(id) {
    await supabase.from('scheduling_suggestions').update({
      status: 'accepted',
      accepted_at: new Date().toISOString()
    }).eq('id', id)
    loadData()
  }

  const getPriorityColor = (priority) => {
    if (priority === 'high') return 'border-l-red-500 bg-red-50'
    if (priority === 'medium') return 'border-l-amber-500 bg-amber-50'
    return 'border-l-blue-500 bg-blue-50'
  }

  const getTypeIcon = (type) => {
    return { fill_gap: '📅', overdue_visit: '⏰', rebalance_workload: '⚖️', new_customer_placement: '👤' }[type] || '💡'
  }

  if (isWorker) {
    return <div className="p-6 text-center text-gray-500">Smart scheduling is not available for field workers.</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Smart Scheduling</h1>
          <p className="text-gray-500">AI-powered scheduling suggestions</p>
        </div>
        {isAdmin && (
          <button
            onClick={generateSuggestions}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? '⏳ Generating...' : '🔄 Regenerate Suggestions'}
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b">
        {['suggestions', 'overdue', 'workload'].map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 font-medium ${
              view === v ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
            }`}
          >
            {v === 'suggestions' ? 'AI Suggestions' : v === 'overdue' ? 'Overdue Visits' : 'Workload'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin text-4xl">⏳</div>
        </div>
      ) : view === 'suggestions' ? (
        <div className="space-y-4">
          {suggestions.filter(s => s.status === 'pending').length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <div className="text-4xl mb-4">✨</div>
              <h3 className="text-lg font-semibold text-gray-800">No pending suggestions</h3>
              <p className="text-gray-500 mb-4">Generate new scheduling suggestions</p>
              {isAdmin && (
                <button
                  onClick={generateSuggestions}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Generate Now
                </button>
              )}
            </div>
          ) : (
            suggestions.filter(s => s.status === 'pending').map(sugg => (
              <div key={sugg.id} className={`p-4 rounded-lg border-l-4 ${getPriorityColor(sugg.priority)} bg-white`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{getTypeIcon(sugg.suggestion_type)}</span>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          sugg.priority === 'high' ? 'bg-red-100 text-red-700' :
                          sugg.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {sugg.priority?.toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-500">{sugg.ai_reasoning}</span>
                      </div>
                      <h3 className="font-semibold text-gray-800">{sugg.title}</h3>
                      <p className="text-gray-600">{sugg.description}</p>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => acceptSuggestion(sugg.id)}
                        className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => dismissSuggestion(sugg.id, 'not needed')}
                        className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : view === 'overdue' ? (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Address</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Last Visit</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Days Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {overdue.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No overdue customers</td></tr>
              ) : overdue.map(cust => (
                <tr key={cust.customer_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{cust.customer_name}</td>
                  <td className="px-4 py-3 text-gray-600">{cust.address}, {cust.postcode}</td>
                  <td className="px-4 py-3 text-gray-600">{cust.last_visit_date ? new Date(cust.last_visit_date).toLocaleDateString('en-GB') : 'Never'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-sm ${cust.days_since_visit > 35 ? 'bg-red-100 text-red-700' : cust.days_since_visit > 21 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                      {cust.days_since_visit} days
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-800 mb-4">Worker Workload (Next 14 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={workload}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="worker_name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="jobs_scheduled" fill="#3B82F6" name="Jobs" />
              <Bar dataKey="routes_scheduled" fill="#10B981" name="Routes" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 text-sm text-gray-500">
            Average: {workload.length > 0 ? (workload.reduce((sum, w) => sum + w.jobs_scheduled, 0) / workload.length).toFixed(1) : 0} jobs/worker
          </div>
        </div>
      )}
    </div>
  )
}