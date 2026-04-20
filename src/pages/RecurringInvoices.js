import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
]

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const PAYMENT_TERMS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
]

export default function RecurringInvoices({ user }) {
  const [templates, setTemplates] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [filter, setFilter] = useState('all')
  
  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const canDelete = user?.role === 'admin'

  useEffect(() => {
    fetchTemplates()
    fetchCustomers()
  }, [statusFilter])

  const fetchTemplates = async () => {
    setLoading(true)
    let query = supabase
      .from('recurring_invoice_templates')
      .select('*, customers(name), recurring_invoice_line_items(*)')
      .order('next_run_date', { ascending: true })

    if (statusFilter === 'active') {
      query = query.eq('is_active', true)
    } else if (statusFilter === 'paused') {
      query = query.eq('is_active', false)
    }

    const { data } = await query
    setTemplates(data || [])
    setLoading(false)
  }

  const fetchCustomers = async () => {
    const { data } = await supabase.from('customers').select('id, name, price, service_type, gc_mandate_id').order('name')
    setCustomers(data || [])
  }

  const formatMoney = (amount) => `£${(amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`

  const getLineItemSummary = (items) => {
    if (!items || items.length === 0) return 'No items'
    const total = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
    return `${items.length} item${items.length > 1 ? 's' : ''} (${formatMoney(total)})`
  }

  const handleToggleActive = async (template) => {
    if (!canEdit) return
    await supabase
      .from('recurring_invoice_templates')
      .update({ is_active: !template.is_active })
      .eq('id', template.id)
    fetchTemplates()
  }

  const handleRunNow = async (template) => {
    if (!canEdit) return
    
    // Call Edge Function to run this template immediately
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/process-recurring-invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: template.id, run_now: true }),
      })
      const result = await response.json()
      alert(`Invoice generated: ${result.invoice_number}`)
      fetchTemplates()
    } catch (error) {
      alert('Failed to run template: ' + error.message)
    }
  }

  const handleDelete = async (template) => {
    if (!canDelete) return
    if (!window.confirm('Are you sure you want to delete this recurring invoice?')) return
    
    await supabase.from('recurring_invoice_templates').delete().eq('id', template.id)
    fetchTemplates()
  }

  const filteredTemplates = templates.filter(t => {
    if (filter === 'all') return true
    if (filter === 'active') return t.is_active
    if (filter === 'paused') return !t.is_active
    return t.frequency === filter
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recurring Invoices</h1>
          <p className="text-gray-600 text-sm">Automate invoice generation for regular customers</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            + Create Recurring Invoice
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        {[
          { value: 'all', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'paused', label: 'Paused' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              filter === f.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Templates Table */}
      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-8 bg-white rounded-lg border">
          <p className="text-gray-500 mb-4">No recurring invoices yet.</p>
          {canEdit && (
            <Link to="/invoices/recurring/new" className="text-blue-600 hover:underline">Create your first recurring invoice</Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-sm font-medium">Customer</th>
                <th className="text-left p-3 text-sm font-medium">Frequency</th>
                <th className="text-left p-3 text-sm font-medium">Next Run</th>
                <th className="text-left p-3 text-sm font-medium">Last Run</th>
                <th className="text-left p-3 text-sm font-medium">Amount</th>
                <th className="text-left p-3 text-sm font-medium">Auto-Collect</th>
                <th className="text-left p-3 text-sm font-medium">Status</th>
                {canEdit && <th className="text-right p-3 text-sm font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map(template => (
                <tr key={template.id} className="border-t">
                  <td className="p-3">
                    <Link to={`/customers/${template.customer_id}`} className="text-blue-600 hover:underline">
                      {template.customers?.name}
                    </Link>
                  </td>
                  <td className="p-3 capitalize">{template.frequency}</td>
                  <td className="p-3">{template.next_run_date}</td>
                  <td className="p-3">{template.last_run_date || '-'}</td>
                  <td className="p-3">
                    {getLineItemSummary(template.recurring_invoice_line_items)}
                  </td>
                  <td className="p-3">
                    {template.auto_collect ? (
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Yes</span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">No</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 text-xs rounded ${
                      template.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {template.is_active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="p-3 text-right">
                      <button onClick={() => handleRunNow(template)} className="text-blue-600 text-sm mr-3 hover:underline">
                        Run Now
                      </button>
                      <Link to={`/invoices/recurring/${template.id}/edit`} className="text-gray-600 text-sm mr-3 hover:underline">
                        Edit
                      </Link>
                      <button onClick={() => handleToggleActive(template)} className="text-gray-600 text-sm mr-3 hover:underline">
                        {template.is_active ? 'Pause' : 'Activate'}
                      </button>
                      {canDelete && (
                        <button onClick={() => handleDelete(template)} className="text-red-600 text-sm hover:underline">
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recurring Invoice Form Modal */}
      {showForm && (
        <RecurringInvoiceForm
          customers={customers}
          onSave={() => { setShowForm(false); fetchTemplates() }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

function RecurringInvoiceForm({ customers, onSave, onCancel, initialData }) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    customer_id: initialData?.customer_id || '',
    frequency: initialData?.frequency || 'monthly',
    day_of_week: initialData?.day_of_week ?? null,
    day_of_month: initialData?.day_of_month || 1,
    next_run_date: initialData?.next_run_date || new Date().toISOString().split('T')[0],
    payment_terms: initialData?.payment_terms || 30,
    auto_collect: initialData?.auto_collect || false,
    send_on_create: initialData?.send_on_create || false,
    notes: initialData?.notes || '',
    is_active: initialData?.is_active !== false,
  })
  const [items, setItems] = useState(initialData?.recurring_invoice_line_items || [
    { description: '', quantity: 1, unit_price: 0, vat_rate: 20 }
  ])

  const customer = customers.find(c => c.id === form.customer_id)
  const hasMandate = customer?.gc_mandate_id

  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
  const vat = items.reduce((sum, item) => sum + (item.quantity * item.unit_price * item.vat_rate / 100), 0)
  const total = subtotal + vat

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

  const handleSave = async () => {
    if (!form.customer_id) return
    setLoading(true)

    try {
      // Save template
      const { data: template, error } = await supabase
        .from('recurring_invoice_templates')
        .insert({
          customer_id: form.customer_id,
          frequency: form.frequency,
          day_of_week: ['weekly', 'fortnightly'].includes(form.frequency) ? form.day_of_week : null,
          day_of_month: ['monthly', 'quarterly', 'annually'].includes(form.frequency) ? form.day_of_month : null,
          next_run_date: form.next_run_date,
          payment_terms: form.payment_terms,
          auto_collect: form.auto_collect,
          send_on_create: form.send_on_create,
          notes: form.notes,
          is_active: form.is_active,
        })
        .select()
        .single()

      if (error) throw error

      // Save line items
      const lineItems = items.map(item => ({
        template_id: template.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        line_total: item.quantity * item.unit_price * (1 + item.vat_rate / 100),
      }))

      await supabase.from('recurring_invoice_line_items').insert(lineItems)

      onSave()
    } catch (error) {
      alert('Error saving: ' + error.message)
    }
    setLoading(false)
  }

  const formatMoney = (amount) => `£${(amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Recurring Invoice</h2>
            <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">✕</button>
          </div>

          {/* Step indicator */}
          <div className="flex gap-2 mb-6">
            {[1, 2, 3].map(s => (
              <div key={s} className={`flex-1 h-1 rounded ${step >= s ? 'bg-blue-600' : 'bg-gray-200'}`} />
            ))}
          </div>

          {/* Step 1: Customer & Schedule */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="font-medium mb-4">Step 1: Customer & Schedule</h3>
              
              <div>
                <label className="block text-sm font-medium mb-1">Customer *</label>
                <select
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Select customer</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>

              {['weekly', 'fortnightly'].includes(form.frequency) && (
                <div>
                  <label className="block text-sm font-medium mb-1">Day of Week</label>
                  <select
                    value={form.day_of_week ?? 1}
                    onChange={(e) => setForm({ ...form, day_of_week: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {DAYS_OF_WEEK.filter(d => d.value >= 1 && d.value <= 5).map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {['monthly', 'quarterly', 'annually'].includes(form.frequency) && (
                <div>
                  <label className="block text-sm font-medium mb-1">Day of Month (1-28)</label>
                  <select
                    value={form.day_of_month}
                    onChange={(e) => setForm({ ...form, day_of_month: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">First Invoice Date</label>
                <input
                  type="date"
                  value={form.next_run_date}
                  onChange={(e) => setForm({ ...form, next_run_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Payment Terms</label>
                <select
                  value={form.payment_terms}
                  onChange={(e) => setForm({ ...form, payment_terms: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {PAYMENT_TERMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Step 2: Line Items */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-medium mb-4">Step 2: Line Items</h3>
              <p className="text-sm text-gray-500 mb-4">These amounts will appear on every generated invoice.</p>

              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-end">
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
                  <button onClick={() => removeItem(i)} className="text-red-600 p-2">✕</button>
                </div>
              ))}

              <button onClick={addItem} className="text-blue-600 text-sm">+ Add Item</button>

              <div className="border-t pt-4 mt-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span>{formatMoney(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>VAT:</span>
                  <span>{formatMoney(vat)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg mt-2">
                  <span>Total:</span>
                  <span>{formatMoney(total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Collection Settings */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="font-medium mb-4">Step 3: Collection Settings</h3>

              {!hasMandate && form.customer_id && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  ⚠️ Customer has no active direct debit mandate. Set one up on the customer page to enable auto-collection.
                </div>
              )}

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.auto_collect}
                  onChange={(e) => setForm({ ...form, auto_collect: e.target.checked })}
                  disabled={!hasMandate && form.customer_id}
                  className="rounded"
                />
                <span>Auto-collect via Direct Debit</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.send_on_create}
                  onChange={(e) => setForm({ ...form, send_on_create: e.target.checked })}
                  className="rounded"
                />
                <span>Send invoice email automatically</span>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Optional notes..."
                />
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-6 pt-4 border-t">
            {step > 1 ? (
              <button onClick={() => setStep(step - 1)} className="px-4 py-2 bg-gray-100 rounded-lg">Back</button>
            ) : (
              <button onClick={onCancel} className="px-4 py-2 bg-gray-100 rounded-lg">Cancel</button>
            )}
            
            {step < 3 ? (
              <button onClick={() => setStep(step + 1)} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
                Next
              </button>
            ) : (
              <button onClick={handleSave} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
                {loading ? 'Saving...' : 'Create'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}