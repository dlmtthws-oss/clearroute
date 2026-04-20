import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const EVENT_TYPES = {
  unusual_login: 'Unusual Login',
  bank_detail_change: 'Bank Detail Change',
  invoice_manipulation: 'Invoice Manipulation',
  bulk_deletion: 'Bulk Deletion',
  payment_redirect: 'Payment Redirect',
  unusual_payment_amount: 'Unusual Payment',
  mandate_change: 'Mandate Change',
  off_hours_activity: 'Off-Hours Activity',
  repeated_failed_access: 'Failed Access',
  data_export_unusual: 'Data Export',
  suspicious_expense: 'Suspicious Expense',
  customer_data_change: 'Customer Change'
}

const SEVERITY_COLORS = {
  critical: 'bg-red-600 text-white',
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200'
}

const STATUS_COLORS = {
  open: 'bg-red-100 text-red-800',
  investigating: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  false_positive: 'bg-gray-100 text-gray-800'
}

export default function RiskDashboard({ onViewInvoice }) {
  const [stats, setStats] = useState({ open: 0, investigating: 0, resolved: 0, false_positive: 0, bySeverity: {}, monthlyTotal: 0 })
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: 'all', severity: 'all', eventType: 'all' })
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [relatedEvents, setRelatedEvents] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [thresholds, setThresholds] = useState({})

  useEffect(() => {
    fetchStats()
    fetchEvents()
    fetchThresholds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedEvent) {
      fetchRelatedEvents(selectedEvent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent])

  const fetchStats = async () => {
    const { data } = await supabase
      .from('risk_events')
      .select('severity, status, created_at')

    if (data) {
      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      data.forEach(e => {
        bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1
      })

      setStats({
        open: data.filter(e => e.status === 'open').length,
        investigating: data.filter(e => e.status === 'investigating').length,
        resolved: data.filter(e => e.status === 'resolved').length,
        false_positive: data.filter(e => e.status === 'false_positive').length,
        bySeverity,
        monthlyTotal: data.filter(e => new Date(e.created_at) > thirtyDaysAgo).length
      })
    }
  }

  const fetchEvents = async () => {
    let query = supabase
      .from('risk_events')
      .select('*, profiles.email, profiles.full_name')
      .order('created_at', { ascending: false })
      .limit(50)

    if (filter.status !== 'all') query = query.eq('status', filter.status)
    if (filter.severity !== 'all') query = query.eq('severity', filter.severity)
    if (filter.eventType !== 'all') query = query.eq('event_type', filter.eventType)

    const { data } = await query
    setEvents(data || [])
    setLoading(false)
  }

  const fetchThresholds = async () => {
    const { data } = await supabase.from('risk_thresholds').select('*')
    if (data) {
      const t = {}
      data.forEach(th => { t[th.threshold_type] = th.value })
      setThresholds(t)
    }
  }

  const fetchRelatedEvents = async (event) => {
    const { data } = await supabase
      .from('risk_events')
      .select('*')
      .eq('user_id', event.user_id)
      .neq('id', event.id)
      .order('created_at', { ascending: false })
      .limit(10)

    setRelatedEvents(data || [])
  }

  const resolveEvent = async (eventId, status, note) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('risk_events')
      .update({
        status,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
        resolution_note: note
      })
      .eq('id', eventId)

    if (!error) {
      fetchStats()
      fetchEvents()
      setSelectedEvent(null)
    }
  }

  const suspendUser = async (userId) => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_suspended: true, suspended_at: new Date().toISOString() })
      .eq('id', userId)

    if (!error) {
      alert('User has been suspended')
    }
  }

  const getSecurityScore = () => {
    const openCritical = stats.bySeverity?.critical || 0
    const openHigh = stats.bySeverity?.high || 0
    if (openCritical > 0) return 30
    if (openHigh > 2) return 60
    if (stats.open > 0) return 75
    return 95
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Risk Dashboard</h2>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          {showSettings ? 'Hide Settings' : 'Risk Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Risk Thresholds</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(thresholds).map(([key, value]) => (
              <div key={key} className="p-3 bg-gray-50 rounded">
                <div className="text-xs text-gray-500 uppercase">{key.replace(/_/g, ' ')}</div>
                <div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Security Score</div>
          <div className={`text-3xl font-bold ${getSecurityScore() < 70 ? 'text-red-600' : getSecurityScore() < 85 ? 'text-yellow-600' : 'text-green-600'}`}>
            {getSecurityScore()}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Open</div>
          <div className="text-2xl font-bold text-red-600">{stats.open}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Investigating</div>
          <div className="text-2xl font-bold text-yellow-600">{stats.investigating}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Resolved (30d)</div>
          <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Monthly Total</div>
          <div className="text-2xl font-bold">{stats.monthlyTotal}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-red-600"></div>
            <span className="text-sm text-gray-500">Critical</span>
          </div>
          <div className="text-xl font-bold">{stats.bySeverity?.critical || 0}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <span className="text-sm text-gray-500">High</span>
          </div>
          <div className="text-xl font-bold">{stats.bySeverity?.high || 0}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <span className="text-sm text-gray-500">Medium</span>
          </div>
          <div className="text-xl font-bold">{stats.bySeverity?.medium || 0}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-blue-400"></div>
            <span className="text-sm text-gray-500">Low</span>
          </div>
          <div className="text-xl font-bold">{stats.bySeverity?.low || 0}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-gray-900">Risk Events</h3>
          <div className="flex flex-wrap gap-2">
            <select
              value={filter.status}
              onChange={(e) => { setFilter(f => ({ ...f, status: e.target.value })); setLoading(true) }}
              onLoad={fetchEvents}
              className="px-3 py-1 border rounded text-sm"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="false_positive">False Positive</option>
            </select>
            <select
              value={filter.severity}
              onChange={(e) => { setFilter(f => ({ ...f, severity: e.target.value })); setLoading(true) }}
              className="px-3 py-1 border rounded text-sm"
            >
              <option value="all">All Severity</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={filter.eventType}
              onChange={(e) => { setFilter(f => ({ ...f, eventType: e.target.value })); setLoading(true) }}
              className="px-3 py-1 border rounded text-sm"
            >
              <option value="all">All Types</option>
              {Object.entries(EVENT_TYPES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No risk events found</div>
        ) : (
          <div className="divide-y max-h-[500px] overflow-y-auto">
            {events.map((event) => (
              <div
                key={event.id}
                onClick={() => setSelectedEvent(event)}
                className="p-4 hover:bg-gray-50 cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${SEVERITY_COLORS[event.severity]}`}>
                      {event.severity}
                    </span>
                    <div>
                      <div className="font-medium">{event.title}</div>
                      <div className="text-sm text-gray-500">
                        {EVENT_TYPES[event.event_type] || event.event_type} • Score: {event.risk_score}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">{event.description}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[event.status]}`}>
                      {event.status}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      {new Date(event.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Event Details</h3>
              <button onClick={() => setSelectedEvent(null)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded text-sm font-medium ${SEVERITY_COLORS[selectedEvent.severity]}`}>
                  {selectedEvent.severity.toUpperCase()}
                </span>
                <span className={`px-3 py-1 rounded text-sm ${STATUS_COLORS[selectedEvent.status]}`}>
                  {selectedEvent.status}
                </span>
              </div>

              <div>
                <div className="text-lg font-semibold">{selectedEvent.title}</div>
                <div className="text-sm text-gray-500">{EVENT_TYPES[selectedEvent.event_type]}</div>
              </div>

              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500 mb-1">Description</div>
                <div>{selectedEvent.description}</div>
              </div>

              {selectedEvent.ai_assessment && (
                <div className="bg-purple-50 p-4 rounded border border-purple-200">
                  <div className="text-sm font-semibold text-purple-800 mb-1">AI Assessment</div>
                  <div className="text-sm whitespace-pre-wrap">{selectedEvent.ai_assessment}</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Risk Score</div>
                  <div className="font-medium">{selectedEvent.risk_score}</div>
                </div>
                <div>
                  <div className="text-gray-500">Created</div>
                  <div className="font-medium">{new Date(selectedEvent.created_at).toLocaleString()}</div>
                </div>
                {selectedEvent.ip_address && (
                  <div>
                    <div className="text-gray-500">IP Address</div>
                    <div className="font-medium">{selectedEvent.ip_address}</div>
                  </div>
                )}
                {selectedEvent.profiles?.email && (
                  <div>
                    <div className="text-gray-500">User</div>
                    <div className="font-medium">{selectedEvent.profiles.email}</div>
                  </div>
                )}
              </div>

              {relatedEvents.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-2">Related Events ({relatedEvents.length})</div>
                  <div className="space-y-2">
                    {relatedEvents.slice(0, 5).map(e => (
                      <div key={e.id} className="text-sm p-2 bg-gray-50 rounded flex justify-between">
                        <span>{e.title}</span>
                        <span className="text-gray-500">{new Date(e.created_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4 space-y-2">
                <div className="text-sm font-semibold">Actions</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => resolveEvent(selectedEvent.id, 'resolved', '')}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => resolveEvent(selectedEvent.id, 'false_positive', '')}
                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                  >
                    False Positive
                  </button>
                  <button
                    onClick={() => resolveEvent(selectedEvent.id, 'investigating', '')}
                    className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
                  >
                    Investigating
                  </button>
                  {selectedEvent.user_id && (
                    <button
                      onClick={() => suspendUser(selectedEvent.user_id)}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Suspend User
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}