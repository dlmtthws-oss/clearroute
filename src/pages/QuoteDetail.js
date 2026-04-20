import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
  superseded: 'bg-gray-100 text-gray-500',
}

export default function QuoteDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quote, setQuote] = useState(null)
  const [items, setItems] = useState([])
  const [customer, setCustomer] = useState(null)
  const [loading, setLoading] = useState(true)
  
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => {
    loadQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadQuote() {
    const { data: quoteData } = await supabase
      .from('quotes')
      .select('*, customers(*)')
      .eq('id', id)
      .single()

    if (quoteData) {
      setQuote(quoteData)
      setCustomer(quoteData.customers)
      
      const { data: itemsData } = await supabase
        .from('quote_line_items')
        .select('*')
        .eq('quote_id', id)
      setItems(itemsData || [])
    }
    setLoading(false)
  }

  const handleStatusChange = async (newStatus) => {
    const updates = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'accepted' && quote.status === 'sent') {
      updates.status = 'accepted'
    }
    await supabase.from('quotes').update(updates).eq('id', id)
    setQuote({ ...quote, ...updates })
    
    let auditAction
    if (newStatus === 'sent') auditAction = AUDIT_ACTIONS.QUOTE_SENT
    else if (newStatus === 'accepted') auditAction = AUDIT_ACTIONS.QUOTE_ACCEPTED
    else if (newStatus === 'declined') auditAction = AUDIT_ACTIONS.QUOTE_DECLINED
    else return
    
    logAuditEvent(
      auditAction,
      'quote',
      id,
      quote.quote_number,
      { status: quote.status },
      { status: newStatus }
    )
  }

  const handleConvertToInvoice = async () => {
    try {
      const invoiceId = await supabase.rpc('convert_quote_to_invoice', { p_quote_id: id })
      
      logAuditEvent(
        AUDIT_ACTIONS.QUOTE_CONVERTED_TO_INVOICE,
        'quote',
        id,
        quote.quote_number,
        quote,
        { converted_to_invoice: invoiceId }
      )
      
      alert('Quote converted! Review and send your invoice.')
      navigate(`/invoices/${invoiceId}`)
    } catch (error) {
      alert('Error converting quote: ' + error.message)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Delete this quote?')) return
    await supabase.from('quotes').delete().eq('id', id)
    navigate('/quotes')
    
    logAuditEvent(
      AUDIT_ACTIONS.QUOTE_DECLINED,
      'quote',
      id,
      quote?.quote_number,
      quote,
      null
    )
  }

  const getExpiryDays = () => {
    if (!quote?.expiry_date) return null
    return Math.floor((new Date(quote.expiry_date) - new Date()) / (1000 * 60 * 60 * 24))
  }

  const formatMoney = (amount) => `£${(amount || 0).toFixed(2)}`
  const formatDate = (date) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) return <div className="p-6">Loading...</div>
  if (!quote) return <div className="p-6">Quote not found</div>

  const expiryDays = getExpiryDays()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/quotes" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{quote.quote_number}</h1>
            <p className="text-gray-500">{customer?.name || quote.prospect_name || 'Prospect'}</p>
          </div>
        </div>
        <span className={`text-sm px-3 py-1 rounded ${STATUS_COLORS[quote.status]}`}>
          {quote.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quote Details */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Quote Details</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Issue Date</p>
                <p className="font-medium">{formatDate(quote.issue_date)}</p>
              </div>
              <div>
                <p className="text-gray-500">Expiry Date</p>
                <p className="font-medium">{formatDate(quote.expiry_date)}</p>
                {expiryDays !== null && (
                  <p className={`text-sm ${expiryDays < 0 ? 'text-red-600' : expiryDays < 7 ? 'text-amber-600' : 'text-gray-600'}`}>
                    {expiryDays < 0 ? `Expired ${Math.abs(expiryDays)} days ago` : `Expires in ${expiryDays} days`}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Line Items</h2>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-2">Description</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-right py-2">Price</th>
                  <th className="text-right py-2">VAT</th>
                  <th className="text-right py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">{item.description}</td>
                    <td className="text-right py-2">{item.quantity}</td>
                    <td className="text-right py-2">{formatMoney(item.unit_price)}</td>
                    <td className="text-right py-2">{item.vat_rate}%</td>
                    <td className="text-right py-2 font-medium">{formatMoney(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right py-2">Subtotal</td>
                  <td className="text-right py-2">{formatMoney(quote.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="text-right py-2">VAT</td>
                  <td className="text-right py-2">{formatMoney(quote.vat_amount)}</td>
                </tr>
                <tr className="font-bold">
                  <td colSpan={4} className="text-right py-2">Total</td>
                  <td className="text-right py-2">{formatMoney(quote.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Notes */}
          {(quote.notes || quote.internal_notes) && (
            <div className="bg-white p-6 rounded-lg border">
              <h2 className="font-medium mb-4">Notes</h2>
              {quote.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500">Customer Notes</p>
                  <p className="whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}
              {quote.internal_notes && (
                <div>
                  <p className="text-sm text-gray-500">Internal Notes</p>
                  <p className="whitespace-pre-wrap text-gray-400">{quote.internal_notes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Actions</h2>
            
            {quote.status === 'draft' && canEdit && (
              <div className="space-y-2">
                <Link to={`/quotes/${id}/edit`} className="block w-full py-2 text-center bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Edit Quote
                </Link>
                <button
                  onClick={() => handleStatusChange('sent')}
                  className="block w-full py-2 text-center border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Send Quote
                </button>
                <button onClick={handleDelete} className="block w-full py-2 text-center text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            )}

            {quote.status === 'sent' && canEdit && (
              <div className="space-y-2">
                <button
                  onClick={() => handleStatusChange('accepted')}
                  className="block w-full py-2 text-center bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Mark as Accepted
                </button>
                <button
                  onClick={() => handleStatusChange('declined')}
                  className="block w-full py-2 text-center border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                >
                  Mark as Declined
                </button>
              </div>
            )}

            {quote.status === 'accepted' && (
              <div className="space-y-2">
                <button
                  onClick={handleConvertToInvoice}
                  className="block w-full py-3 text-center bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                >
                  Convert to Invoice
                </button>
                {quote.converted_to_invoice_id && (
                  <Link
                    to={`/invoices/${quote.converted_to_invoice_id}`}
                    className="block w-full py-2 text-center text-blue-600 hover:underline"
                  >
                    View Invoice →
                  </Link>
                )}
              </div>
            )}

            {quote.status === 'expired' && canEdit && (
              <button
                onClick={() => handleStatusChange('draft')}
                className="block w-full py-2 text-center border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Reopen as Draft
              </button>
            )}
          </div>

          {/* Customer Info */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Customer</h2>
            {customer ? (
              <div>
                <p className="font-medium">{customer.name}</p>
                <p className="text-sm text-gray-500">{customer.address_line_1}</p>
                <p className="text-sm text-gray-500">{customer.city}, {customer.postcode}</p>
                <Link to={`/customers/${customer.id}`} className="text-sm text-blue-600 hover:underline">
                  View Customer →
                </Link>
              </div>
            ) : (
              <div>
                <p className="font-medium">{quote.prospect_name || 'Unknown'}</p>
                {quote.prospect_email && <p className="text-sm text-gray-500">{quote.prospect_email}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}