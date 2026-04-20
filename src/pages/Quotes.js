import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'
import { SkeletonTable } from '../components/SkeletonComponents'
import { EmptyStateQuotes } from '../components/EmptyStates'

const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired', 'superseded']
const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
  superseded: 'bg-gray-100 text-gray-500',
}

export default function Quotes({ user }) {
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [summary, setSummary] = useState({ open: 0, openTotal: 0, accepted: 0, acceptedTotal: 0, conversion: 0, expired: 0 })
  
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => {
    loadQuotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  async function loadQuotes() {
    setLoading(true)
    let query = supabase
      .from('quotes')
      .select('*, customers(name), quote_line_items(*)')
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data } = await query
    
    if (data) {
      setQuotes(data)
      calculateSummary(data)
    }
    setLoading(false)
  }

  function calculateSummary(quotesData) {
    const open = quotesData.filter(q => q.status === 'draft' || q.status === 'sent')
    const openTotal = open.reduce((s, q) => s + (parseFloat(q.total) || 0), 0)
    
    const accepted = quotesData.filter(q => q.status === 'accepted')
    
    const sent = quotesData.filter(q => q.status === 'sent')
    const conversion = sent.length > 0 ? (accepted.length / sent.length * 100).toFixed(0) : 0
    
    const expired = quotesData.filter(q => q.status === 'expired').length

    setSummary({ 
      open: open.length, 
      openTotal, 
      accepted: accepted.length, 
      acceptedTotal: parseFloat(conversion), 
      expired 
    })
  }

  const handleDelete = async (quoteId) => {
    if (!window.confirm('Delete this quote?')) return
    const quote = quotes.find(q => q.id === quoteId)
    await supabase.from('quotes').delete().eq('id', quoteId)
    loadQuotes()
    
    logAuditEvent(
      AUDIT_ACTIONS.QUOTE_DECLINED,
      'quote',
      quoteId,
      quote?.quote_number,
      quote,
      null
    )
  }

  const getExpiryDays = (expiryDate) => {
    if (!expiryDate) return null
    const days = Math.floor((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
    return days
  }

  const formatMoney = (amount) => `£${(amount || 0).toFixed(2)}`

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Quotes</h1>
          <p className="text-gray-600 text-sm">Manage quotes and estimates</p>
        </div>
        {canEdit && (
          <Link to="/quotes/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            + Create Quote
          </Link>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Open Quotes</p>
          <p className="text-2xl font-bold">{summary.open}</p>
          <p className="text-xs text-gray-400">{formatMoney(summary.openTotal)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Accepted This Month</p>
          <p className="text-2xl font-bold text-green-600">{summary.accepted}</p>
          <p className="text-xs text-gray-400">{formatMoney(summary.acceptedTotal)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Conversion Rate</p>
          <p className="text-2xl font-bold text-blue-600">{summary.acceptedTotal}%</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Expired</p>
          <p className="text-2xl font-bold text-amber-600">{summary.expired}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm ${
            statusFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {STATUSES.slice(0, 4).map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
              statusFilter === status ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Quotes Table */}
      {loading ? (
        <SkeletonTable rows={8} />
      ) : quotes.length === 0 ? (
        <EmptyStateQuotes />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-sm font-medium">Quote</th>
                <th className="text-left p-3 text-sm font-medium">Customer</th>
                <th className="text-left p-3 text-sm font-medium">Issue Date</th>
                <th className="text-left p-3 text-sm font-medium">Expiry</th>
                <th className="text-left p-3 text-sm font-medium">Total</th>
                <th className="text-left p-3 text-sm font-medium">Status</th>
                {canEdit && <th className="text-right p-3 text-sm font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {quotes.map(quote => {
                const expiryDays = getExpiryDays(quote.expiry_date)
                return (
                  <tr key={quote.id} className="border-t">
                    <td className="p-3">
                      <Link to={`/quotes/${quote.id}`} className="text-blue-600 hover:underline font-medium">
                        {quote.quote_number}
                      </Link>
                    </td>
                    <td className="p-3">
                      {quote.customers?.name || quote.prospect_name || '-'}
                    </td>
                    <td className="p-3 text-gray-600">{quote.issue_date}</td>
                    <td className="p-3">
                      <span className={expiryDays < 7 ? 'text-amber-600' : expiryDays < 0 ? 'text-red-600' : ''}>
                        {quote.expiry_date || '-'}
                      </span>
                      {expiryDays !== null && quote.status === 'sent' && (
                        <span className="ml-2 text-xs">
                          ({expiryDays < 0 ? `${Math.abs(expiryDays)}d ago` : `${expiryDays}d`})
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-medium">{formatMoney(quote.total)}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[quote.status]}`}>
                        {quote.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="p-3 text-right">
                        <Link to={`/quotes/${quote.id}/edit`} className="text-blue-600 text-sm hover:underline mr-3">
                          Edit
                        </Link>
                        {quote.status === 'draft' && (
                          <button onClick={() => handleDelete(quote.id)} className="text-red-600 text-sm hover:underline">
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}