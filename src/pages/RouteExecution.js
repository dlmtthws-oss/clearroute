import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function RouteExecution() {
  const { routeId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [route, setRoute] = useState(location.state?.route)
  const [session, setSession] = useState(null)
  const [executions, setExecutions] = useState([])
  const [loading, setLoading] = useState(true)
  const [elapsedTime, setElapsedTime] = useState(0)
  const timerRef = useRef(null)
  
  const { sessionId } = location.state || {}

  useEffect(() => {
    if (sessionId) {
      loadSession()
    }
  }, [sessionId])

  // Wake Lock to keep screen on while executing
  useEffect(() => {
    let wakeLock = null
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen')
        } catch (err) {
          console.log('Wake lock error:', err)
        }
      }
    }
    const releaseWakeLock = async () => {
      if (wakeLock) {
        await wakeLock.release()
        wakeLock = null
      }
    }
    requestWakeLock()
    return () => releaseWakeLock()
  }, [])

  useEffect(() => {
    if (session?.status === 'in_progress') {
      timerRef.current = setInterval(() => {
        const start = new Date(session.started_at).getTime()
        const now = Date.now()
        setElapsedTime(Math.floor((now - start) / 1000 / 60))
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [session?.started_at, session?.status])

  const loadSession = async () => {
    // Get route details
    if (!route) {
      const { data: routeData } = await supabase
        .from('routes')
        .select('*, route_stops(*), workers(name)')
        .eq('id', routeId)
        .single()
      setRoute(routeData)
    }

    // Get session
    const { data: sessionData } = await supabase
      .from('route_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    setSession(sessionData)

    // Get executions
    const { data: executionsData } = await supabase
      .from('job_executions')
      .select('*, customers(name, address_line_1, postcode, phone)')
      .eq('route_session_id', sessionId)
      .order('created_at')
    setExecutions(executionsData || [])
    
    setLoading(false)
  }

  const handleStatusChange = async (executionId, newStatus, notes = null, skipReason = null) => {
    const now = new Date().toISOString()
    const updates = { status: newStatus }
    const execution = executions.find(e => e.id === executionId)
    
    if (newStatus === 'travelling' && execution && !execution.arrived_at) {
      updates.arrived_at = now
    }
    if (newStatus === 'on_site') {
      updates.started_at = now
    }
    if (newStatus === 'completed') {
      updates.completed_at = now
      updates.notes = notes
      if (execution?.started_at) {
        const mins = Math.round((new Date(now) - new Date(execution.started_at)) / 1000 / 60)
        updates.actual_minutes = mins
      }
    }
    if (newStatus === 'skipped') {
      updates.completed_at = now
      updates.skipped_reason = skipReason
    }

    await supabase
      .from('job_executions')
      .update(updates)
      .eq('id', executionId)

    loadSession()
  }

  const handleCompleteRoute = async () => {
    await supabase
      .from('route_sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_actual_minutes: elapsedTime
      })
      .eq('id', sessionId)

    navigate('/my-routes')
  }

  const getActiveExecution = () => {
    return executions.find(e => e.status === 'travelling' || e.status === 'on_site')
  }

  const getCompletedCount = () => {
    return executions.filter(e => e.status === 'completed' || e.status === 'skipped').length
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const activeExecution = getActiveExecution()
  const completedCount = getCompletedCount()
  const allCompleted = completedCount === executions.length && executions.length > 0

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-white p-4 rounded-lg border mb-4">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h1 className="text-xl font-bold">{route?.name}</h1>
            <p className="text-sm text-gray-500">{route?.scheduled_date}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-600">{formatTime(elapsedTime)}</p>
            <p className="text-xs text-gray-500">elapsed</p>
          </div>
        </div>
        
        {/* Progress */}
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div 
            className="bg-green-500 h-3 rounded-full transition-all" 
            style={{ width: `${(completedCount / executions.length) * 100}%` }}
          ></div>
        </div>
        <p className="text-sm text-right mt-1 text-gray-600">
          {completedCount} / {executions.length} completed
        </p>
      </div>

      {/* Stops */}
      <div className="space-y-3">
        {executions.map((execution, index) => {
          const isActive = activeExecution?.id === execution.id
          const isCompleted = execution.status === 'completed'
          const isSkipped = execution.status === 'skipped'

          return (
            <div 
              key={execution.id} 
              className={`bg-white p-4 rounded-lg border ${
                isActive ? 'border-blue-500 ring-2 ring-blue-200' : 
                isCompleted ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Stop number */}
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  isActive ? 'bg-blue-500 text-white' :
                  isCompleted ? 'bg-green-500 text-white' :
                  isSkipped ? 'bg-gray-300 text-gray-600' :
                  'bg-gray-200 text-gray-600'
                }`}>
                  {index + 1}
                </span>

                {/* Customer info */}
                <div className="flex-1">
                  <h3 className="font-medium">{execution.customers?.name}</h3>
                  <p className="text-sm text-gray-500">
                    {execution.customers?.address_line_1}, {execution.customers?.postcode}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Est. {execution.estimated_minutes || 30} min
                    {execution.actual_minutes && ` • Actual: ${execution.actual_minutes} min`}
                  </p>
                </div>

                {/* Status badge */}
                <span className={`px-2 py-1 rounded text-xs ${
                  execution.status === 'completed' ? 'bg-green-100 text-green-800' :
                  execution.status === 'skipped' ? 'bg-gray-200 text-gray-600' :
                  execution.status === 'on_site' ? 'bg-blue-100 text-blue-800' :
                  execution.status === 'travelling' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {execution.status}
                </span>
              </div>

              {/* Action buttons */}
              {execution.status === 'pending' && (
                <button
                  onClick={() => handleStatusChange(execution.id, 'travelling')}
                  className="w-full mt-3 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                >
                  Start Travelling
                </button>
              )}

              {execution.status === 'travelling' && (
                <button
                  onClick={() => handleStatusChange(execution.id, 'on_site')}
                  className="w-full mt-3 py-3 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600"
                >
                  Arrived On Site
                </button>
              )}

              {execution.status === 'on_site' && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatusChange(execution.id, 'completed', '')}
                      className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                    >
                      Complete Job
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt('Reason for skipping:')
                        if (reason) {
                          handleStatusChange(execution.id, 'skipped', null, reason)
                        }
                      }}
                      className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300"
                    >
                      Skip
                    </button>
                  </div>
                  <p className="text-xs text-center text-gray-500">
                    Live timer running...
                  </p>
                </div>
              )}

              {(isCompleted || isSkipped) && (
                <div className="mt-2 text-sm text-gray-500">
                  {isSkipped && <span className="text-red-500">Skipped: {execution.skipped_reason}</span>}
                  {isCompleted && execution.actual_minutes && (
                    <span>Completed in {execution.actual_minutes} min</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Complete Route */}
      {allCompleted && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-green-50 border-t">
          <button
            onClick={handleCompleteRoute}
            className="w-full py-4 bg-green-600 text-white rounded-lg font-bold text-lg hover:bg-green-700"
          >
            Complete Route ({formatTime(elapsedTime)})
          </button>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => navigate('/my-routes')}
        className="mt-6 text-gray-500 hover:text-gray-700"
      >
        ← Back to My Routes
      </button>
    </div>
  )
}