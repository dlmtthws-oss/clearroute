import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function RoutePerformance() {
  const { routeId } = useParams()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ avgVariance: 0, avgTime: 0, completionRate: 0, totalRuns: 0 })

  useEffect(() => {
    loadPerformance()
  }, [routeId])

  const loadPerformance = async () => {
    setLoading(true)
    
    const { data: sessionData } = await supabase
      .from('route_sessions')
      .select('*, workers(name)')
      .eq('route_id', routeId)
      .order('date', { ascending: false })
      .limit(20)

    if (sessionData) {
      setSessions(sessionData)
      
      const completed = sessionData.filter(s => s.status === 'completed')
      const withTime = completed.filter(s => s.total_actual_minutes && s.total_estimated_minutes)
      
      if (withTime.length > 0) {
        const totalVariance = withTime.reduce((sum, s) => {
          const variance = ((s.total_actual_minutes - s.total_estimated_minutes) / s.total_estimated_minutes) * 100
          return sum + variance
        }, 0)
        
        const totalTime = withTime.reduce((sum, s) => sum + s.total_actual_minutes, 0)
        
        setStats({
          avgVariance: Math.round(totalVariance / withTime.length),
          avgTime: Math.round(totalTime / withTime.length),
          completionRate: Math.round((completed.length / sessionData.length) * 100),
          totalRuns: sessionData.length
        })
      }
    }
    setLoading(false)
  }

  const getVarianceColor = (session) => {
    if (!session.total_actual_minutes || !session.total_estimated_minutes) return 'text-gray-400'
    const variance = ((session.total_actual_minutes - session.total_estimated_minutes) / session.total_estimated_minutes) * 100
    if (variance < -5) return 'text-green-600'
    if (variance > 15) return 'text-red-600'
    return 'text-amber-600'
  }

  const getVariancePercent = (session) => {
    if (!session.total_actual_minutes || !session.total_estimated_minutes) return 0
    return Math.round(((session.total_actual_minutes - session.total_estimated_minutes) / session.total_estimated_minutes) * 100)
  }

  const chartData = sessions.slice(0, 12).reverse().map(s => ({
    date: s.date?.slice(5) || '',
    estimated: s.total_estimated_minutes || 0,
    actual: s.total_actual_minutes || 0
  }))

  if (loading) {
    return <div className="p-6 text-gray-500">Loading performance data...</div>
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Route Performance</h2>
        <Link to={`/routes/${routeId}`} className="text-blue-600 hover:underline">
          Back to Route
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Total Runs</p>
          <p className="text-2xl font-bold">{stats.totalRuns}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Avg Time</p>
          <p className="text-2xl font-bold">{stats.avgTime} min</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Avg Variance</p>
          <p className={`text-2xl font-bold ${stats.avgVariance > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {stats.avgVariance > 0 ? '+' : ''}{stats.avgVariance}%
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Completion</p>
          <p className="text-2xl font-bold">{stats.completionRate}%</p>
        </div>
      </div>

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="font-medium mb-4">Estimated vs Actual Time</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="estimated" stroke="#6b7280" strokeDasharray="5 5" name="Estimated (min)" />
              <Line type="monotone" dataKey="actual" stroke="#22c55e" name="Actual (min)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sessions Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Worker</th>
              <th className="text-right px-4 py-3">Est. (min)</th>
              <th className="text-right px-4 py-3">Actual (min)</th>
              <th className="text-right px-4 py-3">Variance</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sessions.map(session => (
              <tr key={session.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{session.date}</td>
                <td className="px-4 py-3">{session.workers?.name || '-'}</td>
                <td className="px-4 py-3 text-right">{session.total_estimated_minutes || '-'}</td>
                <td className="px-4 py-3 text-right">{session.total_actual_minutes || '-'}</td>
                <td className={`px-4 py-3 text-right font-medium ${getVarianceColor(session)}`}>
                  {getVariancePercent(session)}%
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 rounded text-xs ${
                    session.status === 'completed' ? 'bg-green-100 text-green-700' :
                    session.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {session.status}
                  </span>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No sessions yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}