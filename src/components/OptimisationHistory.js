import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

export default function OptimisationHistory() {
  const [optimisations, setOptimisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRun, setSelectedRun] = useState(null)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetchOptimisations()
    fetchStats()
  }, [])

  const fetchOptimisations = async () => {
    const { data } = await supabase
      .from('route_optimisation_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    setOptimisations(data || [])
    setLoading(false)
  }

  const fetchStats = async () => {
    const { data: accepted } = await supabase
      .from('route_optimisation_runs')
      .select('improvement_minutes, improvement_percent, created_at')
      .eq('status', 'accepted')

    const { data: total } = await supabase
      .from('route_optimisation_runs')
      .select('optimisation_type, status')

    if (accepted && total) {
      const avgImprovement = accepted.reduce((sum, r) => sum + (r.improvement_minutes || 0), 0) / accepted.length || 0
      const acceptedCount = total.filter(r => r.status === 'accepted').length
      const pendingCount = total.filter(r => r.status === 'pending').length

      setStats({
        totalRuns: total.length,
        acceptedRuns: acceptedCount,
        pendingRuns: pendingCount,
        avgImprovement: Math.round(avgImprovement),
        byType: total.reduce((acc, r) => {
          acc[r.optimisation_type] = (acc[r.optimisation_type] || 0) + 1
          return acc
        }, {})
      })
    }
  }

  const handleRevert = async (runId) => {
    await supabase
      .from('route_optimisation_runs')
      .delete()
      .eq('id', runId)
    
    fetchOptimisations()
    fetchStats()
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusClasses = (status) => {
    switch (status) {
      case 'accepted':
        return 'bg-green-100 text-green-700'
      case 'rejected':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-yellow-100 text-yellow-700'
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>
  }

  return (
    <div>
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Optimisations"
            value={stats.totalRuns}
            icon="🔄"
          />
          <StatCard
            label="Accepted"
            value={stats.acceptedRuns}
            icon="✅"
          />
          <StatCard
            label="Pending Review"
            value={stats.pendingRuns}
            icon="⏳"
          />
          <StatCard
            label="Avg Improvement"
            value={`${stats.avgImprovement} min`}
            icon="⚡"
          />
        </div>
      )}

      {/* Improvement Chart */}
      {optimisations.filter(o => o.status === 'accepted').length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-medium mb-4">Improvement Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={optimisations
                .filter(o => o.status === 'accepted')
                .slice(0, 20)
                .reverse()
                .map((o, i) => ({
                  name: formatDate(o.created_at),
                  minutes: o.improvement_minutes,
                  percent: o.improvement_percent
                }))
              }
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="minutes"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ fill: '#16a34a' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Optimisation Runs */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h3 className="text-lg font-medium">Optimisation History</h3>
        </div>

        {optimisations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No optimisations yet. Create a route and run optimisation!
          </div>
        ) : (
          <div className="divide-y">
            {optimisations.map(run => (
              <div
                key={run.id}
                className="p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedRun(run)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusClasses(run.status)}`}>
                        {run.status}
                      </span>
                      <span className="text-xs text-gray-500">
                        {run.optimisation_type}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatDate(run.created_at)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-900 mb-1">
                      {run.original_stop_order?.length} → {run.suggested_stop_order?.length} stops
                    </div>
                    <div className="text-sm text-gray-600 truncate">
                      {run.ai_explanation}
                    </div>
                  </div>
                  <div className="text-right">
                    {run.status === 'pending' && run.improvement_minutes > 0 && (
                      <div className="text-green-600 font-medium">
                        -{run.improvement_minutes} min
                      </div>
                    )}
                    {run.confidence_score && (
                      <div className="text-xs text-gray-500">
                        {Math.round(run.confidence_score * 100)}% confidence
                      </div>
                    )}
                  </div>
                </div>

                {selectedRun?.id === run.id && (
                  <div className="mt-4 p-4 bg-gray-50 rounded">
                    <h4 className="font-medium mb-2">Factors Used</h4>
                    <div className="flex gap-2 flex-wrap mb-4">
                      {run.factors_used && Object.entries(run.factors_used).map(([factor, used]) => (
                        <span
                          key={factor}
                          className={`px-2 py-1 rounded text-xs ${
                            used ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {factor}: {used ? '✓' : '✗'}
                        </span>
                      ))}
                    </div>

                    {run.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRevert(run.id)
                          }}
                          className="px-3 py-1 text-sm border rounded hover:bg-gray-100"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}