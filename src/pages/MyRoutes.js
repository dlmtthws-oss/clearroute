import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function MyRoutes({ user }) {
  const [routes, setRoutes] = useState([])
  const [sessions, setSessions] = useState({})
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0])
  const navigate = useNavigate()

  useEffect(() => {
    if (user?.role === 'worker' && user?.id) {
      loadRoutes()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, dateFilter])

  const loadRoutes = async () => {
    setLoading(true)
    
    const { data: workerData } = await supabase
      .from('workers')
      .select('id')
      .eq('email', user?.email)
      .single()
    
    const workerId = workerData?.id
    
    if (!workerId) {
      setLoading(false)
      return
    }

    // Get routes assigned to this worker
    const { data: routeData } = await supabase
      .from('routes')
      .select('*, route_stops(*), workers(name)')
      .eq('assigned_to', workerId)
      .eq('status', 'active')
      .order('scheduled_date')

    if (routeData) {
      // Get sessions for these routes
      const routeIds = routeData.map(r => r.id)
      
      const { data: sessionData } = await supabase
        .from('route_sessions')
        .select('*, route_sessions(*)')
        .in('route_id', routeIds)
        .eq('date', dateFilter)

      const sessionMap = {}
      sessionData?.forEach(s => {
        sessionMap[s.route_id] = s
      })

      // Get execution counts
      const { data: executionData } = await supabase
        .from('job_executions')
        .select('route_session_id, status')
        .in('route_session_id', sessionData?.map(s => s.id) || [])

      const executionCounts = {}
      executionData?.forEach(e => {
        if (!executionCounts[e.route_session_id]) {
          executionCounts[e.route_session_id] = { completed: 0, total: 0 }
        }
        executionCounts[e.route_session_id].total++
        if (e.status === 'completed') {
          executionCounts[e.route_session_id].completed++
        }
      })

      setSessions({ sessions: sessionMap, counts: executionCounts })
      setRoutes(routeData)
    }

    setLoading(false)
  }

  const handleStartRoute = async (route) => {
    const { data: workerData } = await supabase
      .from('workers')
      .select('id')
      .eq('email', user?.email)
      .single()

    if (!workerData?.id) {
      alert('Worker not found')
      return
    }

    // Calculate total estimated minutes
    const totalMinutes = (route.route_stops || []).reduce((sum, s) => sum + (s.estimated_duration || 30), 0)

    // Create session
    const { data: session, error } = await supabase
      .from('route_sessions')
      .insert({
        route_id: route.id,
        worker_id: workerData.id,
        date: dateFilter,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        total_estimated_minutes: totalMinutes
      })
      .select()
      .single()

    if (error) {
      alert('Error starting route: ' + error.message)
      return
    }

    // Create job executions for each stop
    for (const stop of (route.route_stops || [])) {
      await supabase.from('job_executions').insert({
        route_session_id: session.id,
        route_stop_id: stop.id,
        customer_id: stop.customer_id,
        status: 'pending',
        estimated_minutes: stop.estimated_duration || 30
      })
    }

    // Navigate to execution view
    navigate(`/my-routes/${route.id}/execute`, { 
      state: { sessionId: session.id, route } 
    })
  }

  const handleContinueRoute = (route, session) => {
    navigate(`/my-routes/${route.id}/execute`, { 
      state: { sessionId: session.id, route } 
    })
  }

  if (user?.role !== 'worker') {
    return (
      <div className="text-center py-12 bg-white rounded-lg">
        <p className="text-gray-500">This page is for field workers only.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Routes</h1>
          <p className="text-gray-600 text-sm">Today's scheduled routes</p>
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        />
      </div>

      {routes.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-500">No routes assigned for this date.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {routes.map(route => {
            const session = sessions.sessions?.[route.id]
            const counts = sessions.counts?.[session?.id] || { completed: 0, total: route.route_stops?.length || 0 }
            const progress = counts.total > 0 ? (counts.completed / counts.total) * 100 : 0

            return (
              <div key={route.id} className="bg-white p-4 rounded-lg border">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-medium text-lg">{route.name}</h3>
                    <p className="text-sm text-gray-500">
                      {route.route_stops?.length || 0} stops • {(route.route_stops || []).reduce((s, s2) => s + (s2.estimated_duration || 30), 0)} min est.
                    </p>
                  </div>
                  {session ? (
                    <span className={`px-2 py-1 rounded text-xs ${
                      session.status === 'completed' ? 'bg-green-100 text-green-800' :
                      session.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {session.status === 'completed' ? 'Completed' : 
                       session.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">
                      Not Started
                    </span>
                  )}
                </div>

                {session && session.status === 'in_progress' && (
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{counts.completed}/{counts.total} completed</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all" 
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {session?.status === 'completed' ? (
                  <div className="text-sm text-green-600">
                    Route completed in {session.total_actual_minutes} minutes
                  </div>
                ) : session?.status === 'in_progress' ? (
                  <button
                    onClick={() => handleContinueRoute(route, session)}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                  >
                    Continue Route ({counts.completed}/{counts.total})
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartRoute(route)}
                    className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                  >
                    Start Route
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}