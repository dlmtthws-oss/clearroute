import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function WorkerPerformance() {
  const navigate = useNavigate()
  const [workerStats, setWorkerStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    loadWorkerStats()
  }, [dateFrom, dateTo])

  const loadWorkerStats = async () => {
    setLoading(true)
    
    let query = supabase
      .from('route_sessions')
      .select(`
        worker_id,
        workers(name),
        status,
        total_estimated_minutes,
        total_actual_minutes,
        route_sessions!inner(
          route_stops(count)
        )
      `)
      .eq('status', 'completed')

    if (dateFrom) {
      query = query.gte('date', dateFrom)
    }
    if (dateTo) {
      query = query.lte('date', dateTo)
    }

    const { data: sessions } = await query

    if (sessions) {
      const workerMap = {}
      
      sessions.forEach(session => {
        const wid = session.worker_id
        if (!workerMap[wid]) {
          workerMap[wid] = {
            id: wid,
            name: session.workers?.name || 'Unknown',
            routes: 0,
            totalEstimated: 0,
            totalActual: 0,
            completed: 0
          }
        }
        
        const w = workerMap[wid]
        w.routes++
        w.totalEstimated += session.total_estimated_minutes || 0
        w.totalActual += session.total_actual_minutes || 0
        if (session.status === 'completed') w.completed++
      })

      const stats = Object.values(workerMap).map(w => ({
        name: w.name,
        routesCompleted: w.routes,
        avgEstimate: w.totalEstimated > 0 ? Math.round(w.totalEstimated / w.routes) : 0,
        avgActual: w.totalActual > 0 ? Math.round(w.totalActual / w.routes) : 0,
        variance: w.totalEstimated > 0 
          ? Math.round(((w.totalActual - w.totalEstimated) / w.totalEstimated) * 100)
          : 0
      })).sort((a, b) => b.routesCompleted - a.routesCompleted)

      setWorkerStats(stats)
    }
    
    setLoading(false)
  }

  const chartData = workerStats.slice(0, 8).map(w => ({
    name: w.name.length > 10 ? w.name.slice(0, 10) + '...' : w.name,
    estimated: w.avgEstimate,
    actual: w.avgActual
  }))

  if (loading) {
    return <div className="p-6 text-gray-500">Loading worker performance...</div>
  }

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-xl font-bold">Worker Performance</h2>

      {/* Date Filter */}
      <div className="flex gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white p-4 rounded-lg border">
          <h3 className="font-medium mb-4">Average Route Time by Worker</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="estimated" fill="#6b7280" name="Est. (min)" />
              <Bar dataKey="actual" fill="#22c55e" name="Actual (min)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Worker Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3">Worker</th>
              <th className="text-right px-4 py-3">Routes</th>
              <th className="text-right px-4 py-3">Avg Est.</th>
              <th className="text-right px-4 py-3">Avg Actual</th>
              <th className="text-right px-4 py-3">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {workerStats.map(worker => (
              <tr key={worker.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{worker.name}</td>
                <td className="px-4 py-3 text-right">{worker.routesCompleted}</td>
                <td className="px-4 py-3 text-right">{worker.avgEstimate} min</td>
                <td className="px-4 py-3 text-right">{worker.avgActual} min</td>
                <td className={`px-4 py-3 text-right font-medium ${
                  worker.variance > 15 ? 'text-red-600' :
                  worker.variance > 0 ? 'text-amber-600' :
                  'text-green-600'
                }`}>
                  {worker.variance > 0 ? '+' : ''}{worker.variance}%
                </td>
              </tr>
            ))}
            {workerStats.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No performance data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}