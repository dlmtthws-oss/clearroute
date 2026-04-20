import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'

export default function QuoteBuilder({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEditing = !!id

  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [quote, setQuote] = useState({
    customer_id: '',
    prospect_name: '',
    prospect_email: '',
    prospect_address: '',
    issue_date: new Date().toISOString().split('T')[0],
    expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: '',
    internal_notes: '',
    status: 'draft',
    is_prospect: false,
  })
  const [items, setItems] = useState([
    { description: '', quantity: 1, unit_price: 0, vat_rate: 20 }
  ])

  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const canSave = canEdit

  useEffect(() => {
    loadCustomers()
    if (id) {
      loadQuote(id)
    }
  }, [id])

  async function loadCustomers() {
    const { data } = await supabase.from('customers').select('id, name, address_line_1, city, postcode').order('name')
    setCustomers(data || [])
  }

  async function loadQuote(quoteId) {
    const { data } = await supabase
      .from('quotes')
      .select('*, quote_line_items(*)')
      .eq('id', quoteId)
      .single()

    if (data) {
      const isProspect = !data.customer_id
      setQuote({
        customer_id: data.customer_id || '',
        prospect_name: data.prospect_name || '',
        prospect_email: data.prospect_email || '',
        prospect_address: data.prospect_address || '',
        issue_date: data.issue_date,
        expiry_date: data.expiry_date,
        notes: data.notes || '',
        internal_notes: data.internal_notes || '',
        status: data.status,
        is_prospect: isProspect,
      })
      if (data.quote_line_items?.length > 0) {
        setItems(data.quote_line_items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
        })))
      }
    }
    setLoading(false)
  }

  const updateItem = (index, field, value) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const addItem = () => {
    setItems([...items, { description: '', quantity: 1, unit_price: 0, vat_rate: 20 }])
  }

  const removeItem = (index) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
    const vat = items.reduce((sum, item) => sum + (item.quantity * item.unit_price * item.vat_rate / 100), 0)
    return { subtotal, vat, total: subtotal + vat }
  }

  const handleSave = async (sendAfterSave = false) => {
    if (!canSave) return
    setSaving(true)

    try {
      const { subtotal, vat, total } = calculateTotals()
      
      const quoteData = {
        customer_id: quote.is_prospect ? null : quote.customer_id || null,
        prospect_name: quote.is_prospect ? quote.prospect_name : null,
        prospect_email: quote.is_prospect ? quote.prospect_email : null,
        prospect_address: quote.is_prospect ? quote.prospect_address : null,
        issue_date: quote.issue_date,
        expiry_date: quote.expiry_date,
        notes: quote.notes,
        internal_notes: quote.internal_notes,
        status: sendAfterSave ? 'sent' : quote.status,
        subtotal,
        vat_amount: vat,
        total,
      }

      let quoteId = id

      if (isEditing) {
        await supabase.from('quotes').update(quoteData).eq('id', id)
        await supabase.from('quote_line_items').delete().eq('quote_id', id)
        
        logAuditEvent(
          AUDIT_ACTIONS.QUOTE_CREATED,
          'quote',
          id,
          quoteData.quote_number,
          null,
          quoteData
        )
      } else {
        quoteData.quote_number = await supabase.rpc('generate_quote_number')
        const { data } = await supabase.from('quotes').insert(quoteData).select().single()
        quoteId = data.id
        
        logAuditEvent(
          AUDIT_ACTIONS.QUOTE_CREATED,
          'quote',
          quoteId,
          quoteData.quote_number,
          null,
          quoteData
        )
      }

      const lineItems = items.map(item => ({
        quote_id: quoteId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        line_total: item.quantity * item.unit_price * (1 + item.vat_rate / 100),
      }))

      await supabase.from('quote_line_items').insert(lineItems)

      if (sendAfterSave) {
        alert('Quote saved and sent! (Email sending would happen here)')
      }

      navigate(`/quotes/${quoteId}`)
    } catch (error) {
      alert('Error saving quote: ' + error.message)
    }
    setSaving(false)
  }

  const handleConvertToInvoice = async () => {
    if (!id) return
    
    try {
      const invoiceId = await supabase.rpc('convert_quote_to_invoice', { p_quote_id: id })
      alert('Quote converted! Review and send your invoice.')
      navigate(`/invoices/${invoiceId}`)
    } catch (error) {
      alert('Error converting quote: ' + error.message)
    }
  }

  const formatMoney = (amount) => `£${(amount || 0).toFixed(2)}`
  const { subtotal, vat, total } = calculateTotals()

  if (loading) {
    return <div className="p-6">Loading...</div>
  }

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
            <h1 className="text-2xl font-bold">{isEditing ? 'Edit Quote' : 'New Quote'}</h1>
          </div>
        </div>
        {canSave && (
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save & Send
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Selection */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Customer</h2>
            
            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!quote.is_prospect}
                  onChange={() => setQuote({ ...quote, is_prospect: false })}
                  className="rounded"
                />
                <span>Existing Customer</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={quote.is_prospect}
                  onChange={() => setQuote({ ...quote, is_prospect: true })}
                  className="rounded"
                />
                <span>New Prospect</span>
              </label>
            </div>

            {quote.is_prospect ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Prospect Name *</label>
                  <input
                    type="text"
                    value={quote.prospect_name}
                    onChange={(e) => setQuote({ ...quote, prospect_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input
                    type="email"
                    value={quote.prospect_email}
                    onChange={(e) => setQuote({ ...quote, prospect_email: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Address</label>
                  <textarea
                    value={quote.prospect_address}
                    onChange={(e) => setQuote({ ...quote, prospect_address: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={2}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">Select Customer</label>
                <select
                  value={quote.customer_id}
                  onChange={(e) => setQuote({ ...quote, customer_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Select a customer</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} - {c.address_line_1}, {c.city}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Quote Details */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Quote Details</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Issue Date</label>
                <input
                  type="date"
                  value={quote.issue_date}
                  onChange={(e) => setQuote({ ...quote, issue_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={quote.expiry_date}
                  onChange={(e) => setQuote({ ...quote, expiry_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Line Items</h2>
            
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2 items-end">
                <div className="flex-1">
                  <input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateItem(i, 'description', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="w-20">
                  <input
                    type="number"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    placeholder="Price"
                    value={item.unit_price}
                    onChange={(e) => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="w-20">
                  <input
                    type="number"
                    placeholder="VAT%"
                    value={item.vat_rate}
                    onChange={(e) => updateItem(i, 'vat_rate', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <button
                  onClick={() => removeItem(i)}
                  className="p-2 text-red-600"
                  disabled={items.length === 1}
                >
                  ✕
                </button>
              </div>
            ))}

            <button onClick={addItem} className="text-blue-600 text-sm mt-2">
              + Add Item
            </button>
          </div>

          {/* Notes */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Notes</h2>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Customer-facing Notes</label>
              <textarea
                value={quote.notes}
                onChange={(e) => setQuote({ ...quote, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
                placeholder="Will appear on quote PDF..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Internal Notes</label>
              <textarea
                value={quote.internal_notes}
                onChange={(e) => setQuote({ ...quote, internal_notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
                placeholder="Private notes - not shown to customer..."
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Totals */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="font-medium mb-4">Summary</h2>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">VAT</span>
                <span>{formatMoney(vat)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold text-lg">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          {isEditing && quote.status === 'accepted' && (
            <div className="bg-green-50 p-6 rounded-lg border border-green-200">
              <h2 className="font-medium mb-4 text-green-800">Quote Accepted</h2>
              <button
                onClick={handleConvertToInvoice}
                className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
              >
                Convert to Invoice
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}