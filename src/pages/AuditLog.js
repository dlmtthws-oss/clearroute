import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { exportToCSV } from '../lib/exportUtils'

const ENTITY_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'payment', label: 'Payment' },
  { value: 'customer', label: 'Customer' },
  { value: 'route', label: 'Route' },
  { value: 'expense', label: 'Expense' },
  { value: 'quote', label: 'Quote' },
  { value: 'user', label: 'User' },
  { value: 'settings', label: 'Settings' },
  { value: 'vat_return', label: 'VAT Return' },
  { value: 'recurring_invoice', label: 'Recurring Invoice' }
]

const ROLE_BADGES = {
  admin: 'bg-purple-100 text-purple-800',
  manager: 'bg-blue-100 text-blue-800',
  worker: 'bg-green-100 text-green-800'
}

export default function AuditLog({ user }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    entityType: '',
    search: ''
  })

  useEffect(() => {
    loadUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .order('full_name')
    
    setUsers(data || [])
  }

  async function loadLogs() {
    setLoading(true)
    
    let query = supabase
      .from('audit_log_with_labels')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom + 'T00:00:00')
    }
    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo + 'T23:59:59')
    }
    if (filters.userId) {
      query = query.eq('user_id', filters.userId)
    }
    if (filters.entityType) {
      query = query.eq('entity_type', filters.entityType)
    }
    if (filters.search) {
      query = query.ilike('entity_reference', `%${filters.search}%`)
    }

    const { data } = await query
    setLogs(data || [])
    setLoading(false)
  }

  function handleExport() {
    const columns = [
      { key: 'created_at', label: 'Timestamp' },
      { key: 'user_name', label: 'User' },
      { key: 'user_role', label: 'Role' },
      { key: 'action_label', label: 'Action' },
      { key: 'entity_type', label: 'Entity Type' },
      { key: 'entity_reference', label: 'Reference' },
      { key: 'ip_address', label: 'IP Address' }
    ]

    const data = logs.map(log => ({
      ...log,
      created_at: new Date(log.created_at).toLocaleString('en-GB')
    }))

    exportToCSV(data, `ClearRoute_AuditLog_${new Date().toISOString().split('T')[0]}`, columns)
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  function renderDiff(oldValues, newValues) {
    if (!oldValues && !newValues) return null

    const changes = []
    const allKeys = new Set([
      ...Object.keys(oldValues || {}),
      ...Object.keys(newValues || {})
    ])

    for (const key of allKeys) {
      const oldVal = oldValues?.[key]
      const newVal = newValues?.[key]
      
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ key, oldVal, newVal })
      }
    }

    if (changes.length === 0) return null

    return (
      <div className="mt-2 text-sm">
        {changes.map((change, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 py-1 border-b border-gray-100">
            <span className="font-medium">{change.key}</span>
            <span className="text-red-600 line-through">
              {change.oldVal !== undefined ? String(change.oldVal) : '-'}
            </span>
            <span className="text-green-600">
              {change.newVal !== undefined ? String(change.newVal) : '-'}
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">You don't have access to the audit log.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-gray-600 text-sm">Track all system activity</p>
        </div>
        <button onClick={handleExport} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => setFilters({ ...filters, dateFrom: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => setFilters({ ...filters, dateTo: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
            <select
              value={filters.userId}
              onChange={e => setFilters({ ...filters, userId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">All Users</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Entity Type</label>
            <select
              value={filters.entityType}
              onChange={e => setFilters({ ...filters, entityType: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              {ENTITY_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search Reference</label>
            <input
              type="text"
              placeholder="e.g. INV-0001"
              value={filters.search}
              onChange={e => setFilters({ ...filters, search: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
        </div>
      </div>

      {/* Results count */}
      <p className="text-sm text-gray-500 mb-2">{logs.length} entries</p>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Timestamp</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">User</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Entity</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Reference</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No audit log entries found</td>
              </tr>
            ) : (
              logs.map(log => (
                <>
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{log.user_name || 'System'}</span>
                        {log.user_role && (
                          <span className={`text-xs px-2 py-0.5 rounded ${ROLE_BADGES[log.user_role] || 'bg-gray-100'}`}>
                            {log.user_role}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {log.action_label}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="capitalize">{log.entity_type?.replace('_', ' ')}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-xs">
                      {log.entity_reference || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        {expandedId === log.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr key={`${log.id}-expanded`}>
                      <td colSpan={6} className="px-4 py-4 bg-gray-50">
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-medium mb-2">Changes</h4>
                            {log.old_values || log.new_values ? (
                              renderDiff(log.old_values, log.new_values)
                            ) : (
                              <p className="text-sm text-gray-500">No change data available</p>
                            )}
                          </div>
                          <div>
                            <h4 className="font-medium mb-2">Metadata</h4>
                            <div className="text-sm space-y-1">
                              <p><span className="text-gray-500">Entity ID:</span> {log.entity_id || '-'}</p>
                              <p><span className="text-gray-500">IP Address:</span> {log.ip_address || '-'}</p>
                              <p><span className="text-gray-500">User Agent:</span> {log.user_agent ? <span className="truncate max-w-xs">{log.user_agent}</span> : '-'}</p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}