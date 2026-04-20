import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateInvoicePDF } from '../lib/invoicePDF'
import ExportButton from '../components/ExportButton'
import { exportToCSV, exportToExcel, INVOICE_COLUMNS, formatExportFilename } from '../lib/exportUtils'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'
import { getXeroConnection, syncInvoiceToXero } from '../lib/xero'
import { getQuickBooksConnection, syncInvoiceToQBO } from '../lib/quickbooks'
import { SkeletonTable } from '../components/SkeletonComponents'
import { EmptyStateInvoices } from '../components/EmptyStates'

export default function Invoices({ user }) {
  const [invoices, setInvoices] = useState([])
  const [customers, setCustomers] = useState([])
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [summary, setSummary] = useState({ outstanding: 0, overdue: 0, paidThisMonth: 0, drafts: 0 })
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  const [invoice, setInvoice] = useState({ 
    customer_id: '', 
    route_id: '',
    issue_date: new Date().toISOString().split('T')[0],
    due_date: '',
    notes: '',
    status: 'draft'
  })
  const [items, setItems] = useState([{ description: '', quantity: 1, unit_price: 0, vat_rate: 20, line_total: 0 }])
  const [saving, setSaving] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [newPayment, setNewPayment] = useState({ amount: 0, payment_date: '', method: 'bank_transfer', reference: '', notes: '' })
  
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  const handleExportCSV = () => {
    const exportData = filteredInvoices.map(inv => ({
      invoice_number: inv.invoice_number,
      customer_name: inv.customers?.name || '',
      customer_address: `${inv.customers?.address_line_1 || ''}, ${inv.customers?.city || ''} ${inv.customers?.postcode || ''}`,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      status: inv.status,
      subtotal: inv.subtotal,
      vat_amount: inv.vat_amount,
      total: inv.total,
      amount_paid: inv.amount_paid || 0,
      balance_outstanding: inv.total - (inv.amount_paid || 0),
      payment_method: inv.payment_method || '',
      paid_at: inv.paid_at || '',
      route_name: inv.routes?.name || ''
    }))
    exportToCSV(exportData, formatExportFilename('Invoices'), INVOICE_COLUMNS)
  }

  const handleExportExcel = () => {
    const exportData = filteredInvoices.map(inv => ({
      invoice_number: inv.invoice_number,
      customer_name: inv.customers?.name || '',
      customer_address: `${inv.customers?.address_line_1 || ''}, ${inv.customers?.city || ''} ${inv.customers?.postcode || ''}`,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      status: inv.status,
      subtotal: inv.subtotal,
      vat_amount: inv.vat_amount,
      total: inv.total,
      amount_paid: inv.amount_paid || 0,
      balance_outstanding: inv.total - (inv.amount_paid || 0),
      payment_method: inv.payment_method || '',
      paid_at: inv.paid_at || '',
      route_name: inv.routes?.name || ''
    }))
    exportToExcel(exportData, formatExportFilename('Invoices'), INVOICE_COLUMNS, 'Invoices')
  }

  useEffect(() => {
    fetchInvoices()
    fetchCustomers()
    fetchRoutes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchInvoices = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('*, customers(name), routes(name), xero_sync_status, xero_synced_at, xero_sync_error, qbo_sync_status, qbo_synced_at, qbo_sync_error')
      .order('created_at', { ascending: false })
    
    if (data) {
      setInvoices(data)
      calculateSummary(data)
    }
    setLoading(false)
  }

  const calculateSummary = (invoiceData) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    
    let outstanding = 0
    let overdue = 0
    let paidThisMonth = 0
    let drafts = 0
    
    invoiceData.forEach(inv => {
      if (inv.status === 'draft') {
        drafts++
      } else if (inv.status !== 'paid' && inv.status !== 'cancelled') {
        outstanding += (inv.total || 0)
        if (inv.due_date && new Date(inv.due_date) < now) {
          overdue += (inv.total || 0)
        }
      }
      if (inv.status === 'paid' && inv.updated_at && new Date(inv.updated_at) >= startOfMonth) {
        paidThisMonth += (inv.total || 0)
      }
    })
    
    setSummary({ outstanding, overdue, paidThisMonth, drafts })
  }

  const fetchCustomers = async () => {
    const { data } = await supabase.from('customers').select('id, name, price, service_type').order('name')
    setCustomers(data || [])
  }

  const fetchRoutes = async () => {
    const { data } = await supabase.from('routes').select('id, name').order('name')
    setRoutes(data || [])
  }

  const fetchPayments = async (invoiceId) => {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('payment_date', { ascending: false })
    setPayments(data || [])
  }

  const handleCustomerChange = (customerId) => {
    const customer = customers.find(c => c.id === customerId)
    const defaultPrice = customer?.price || 0
    const newItems = [{ 
      description: `${customer?.service_type || 'Window'} cleaning`, 
      quantity: 1, 
      unit_price: defaultPrice, 
      vat_rate: 20, 
      line_total: defaultPrice 
    }]
    setItems(newItems)
    setInvoice({ 
      ...invoice, 
      customer_id: customerId,
      due_date: getDefaultDueDate(30)
    })
  }

  const getDefaultDueDate = (days) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  const calculateTotals = (itemsData) => {
    const subtotal = itemsData.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
    const vat = itemsData.reduce((sum, item) => sum + (item.quantity * item.unit_price * item.vat_rate / 100), 0)
    return { subtotal, vat_amount: vat, total: subtotal + vat }
  }

  const handleSave = async () => {
    if (!invoice.customer_id) return
    setSaving(true)
    
    const year = new Date().getFullYear()
    const count = invoices.length + 1
    const invoice_number = `INV-${year}-${count.toString().padStart(4, '0')}`
    
    const totals = calculateTotals(items)
    
    const { data: invData, error } = await supabase
      .from('invoices')
      .insert([{ 
        ...invoice, 
        invoice_number,
        ...totals
      }])
      .select()
    
    if (!error && invData) {
      const invId = invData[0].id
      
      for (const item of items) {
        if (item.description) {
          await supabase.from('invoice_line_items').insert([{
            invoice_id: invId,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            vat_rate: item.vat_rate,
            line_total: item.quantity * item.unit_price
          }])
        }
      }

      await logAuditEvent(
        AUDIT_ACTIONS.INVOICE_CREATED,
        'invoice',
        invId,
        invoice_number,
        null,
        { ...invoice, ...totals, invoice_number }
      )
      
      setInvoice({ customer_id: '', route_id: '', issue_date: new Date().toISOString().split('T')[0], due_date: '', notes: '', status: 'draft' })
      setItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 20, line_total: 0 }])
      setShowForm(false)
      fetchInvoices()
    }
    setSaving(false)
  }

  // Unused function - keeping for potential future use
  // eslint-disable-next-line no-unused-vars
  const handleUpdateInvoice = async () => {
    if (!selectedInvoice) return
    setSaving(true)
    
    const totals = calculateTotals(items)
    
    await supabase
      .from('invoices')
      .update({ 
        customer_id: selectedInvoice.customer_id,
        route_id: selectedInvoice.route_id,
        issue_date: selectedInvoice.issue_date,
        due_date: selectedInvoice.due_date,
        notes: selectedInvoice.notes,
        status: selectedInvoice.status,
        ...totals
      })
      .eq('id', selectedInvoice.id)
    
    await supabase.from('invoice_line_items').delete().eq('invoice_id', selectedInvoice.id)
    
    for (const item of items) {
      if (item.description) {
        await supabase.from('invoice_line_items').insert([{
          invoice_id: selectedInvoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
          line_total: item.quantity * item.unit_price
        }])
      }
    }
    
    setSaving(false)
    fetchInvoices()
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this invoice?')) return
    await supabase.from('invoices').delete().eq('id', id)
    fetchInvoices()
  }

  const handleStatusChange = async (id, newStatus) => {
    await supabase
      .from('invoices')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
    fetchInvoices()
    if (selectedInvoice?.id === id) {
      setSelectedInvoice({ ...selectedInvoice, status: newStatus })
    }
  }

  const handleAddPayment = async () => {
    if (!selectedInvoice || newPayment.amount <= 0) return
    
    const paymentData = {
      invoice_id: selectedInvoice.id,
      amount: newPayment.amount,
      payment_date: newPayment.payment_date || new Date().toISOString().split('T')[0],
      method: newPayment.method,
      reference: newPayment.reference,
      notes: newPayment.notes
    }
    
    await supabase.from('payments').insert([paymentData])
    
    logAuditEvent(
      AUDIT_ACTIONS.PAYMENT_RECORDED,
      'payment',
      selectedInvoice.id,
      selectedInvoice.invoice_number,
      null,
      paymentData
    )
    
    const { data: allPayments } = await supabase
      .from('payments')
      .select('amount')
      .eq('invoice_id', selectedInvoice.id)
    
    const totalPaid = allPayments?.reduce((sum, p) => sum + p.amount, 0) || 0
    
    if (totalPaid >= selectedInvoice.total) {
      await handleStatusChange(selectedInvoice.id, 'paid')
    }
    
    setShowPaymentForm(false)
    setNewPayment({ amount: 0, payment_date: '', method: 'bank_transfer', reference: '', notes: '' })
    fetchPayments(selectedInvoice.id)
    fetchInvoices()
  }

  const handleViewInvoice = async (inv) => {
    const { data: lineItems } = await supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', inv.id)
    
    const { data: profile } = await supabase.from('settings').select('*').limit(1).single()
    
    setSelectedInvoice({ 
      ...inv, 
      line_items: lineItems || [],
      company: profile || {}
    })
    fetchPayments(inv.id)
  }

  const handleDownloadPDF = async (inv) => {
    try {
      const { data: customer } = await supabase.from('customers').select('*').eq('id', inv.customer_id).single()
      const { data: profile } = await supabase.from('company_settings').select('*').limit(1).single()
      
      const { data: items } = await supabase.from('invoice_line_items').select('*').eq('invoice_id', inv.id)
      
      const invoiceWithItems = { ...inv, items: items || [] }
      const pdf = await generateInvoicePDF(invoiceWithItems, customer, profile || {})
      pdf.save(`${inv.invoice_number}.pdf`)
    } catch (err) {
      alert('PDF generation failed: ' + err.message)
    }
  }

  const handleSendEmail = async (inv) => {
    if (!window.confirm(`Send invoice ${inv.invoice_number} to customer?`)) return
    
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invoice-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ invoice_id: inv.id })
      })
      
      const data = await response.json()
      
      if (data.success) {
        alert('Invoice sent successfully!')
        fetchInvoices()
        setSelectedInvoice({ ...inv, status: 'sent' })
      } else {
        alert('Failed to send: ' + (data.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to send: ' + err.message)
    }
  }

  const addItem = () => {
    setItems([...items, { description: '', quantity: 1, unit_price: 0, vat_rate: 20, line_total: 0 }])
  }

  const removeItem = (index) => {
    const newItems = items.filter((_, i) => i !== index)
    setItems(newItems)
  }

  const updateItem = (index, field, value) => {
    const newItems = [...items]
    newItems[index][field] = field === 'description' || field === 'vat_rate' 
      ? value 
      : Number(value)
    newItems[index].line_total = newItems[index].quantity * newItems[index].unit_price
    setItems(newItems)
  }

  const getStatusBadge = (status) => {
    switch(status) {
      case 'paid': return 'bg-green-100 text-green-800'
      case 'sent': return 'bg-blue-100 text-blue-800'
      case 'overdue': return 'bg-red-100 text-red-800'
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'viewed': return 'bg-purple-100 text-purple-800'
      case 'cancelled': return 'bg-gray-200 text-gray-600'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getDaysOverdue = (dueDate) => {
    if (!dueDate) return 0
    const due = new Date(dueDate)
    const now = new Date()
    const diff = Math.floor((now - due) / (1000 * 60 * 60 * 24))
    return diff > 0 ? diff : 0
  }

  const filteredInvoices = statusFilter === 'all' 
    ? invoices 
    : invoices.filter(i => i.status === statusFilter)

  const totals = calculateTotals(items)
  const selectedTotals = selectedInvoice?.line_items 
    ? calculateTotals(selectedInvoice.line_items) 
    : { subtotal: 0, vat_amount: 0, total: 0 }

  if (loading) return <div className="p-6"><SkeletonTable rows={8} /></div>

  if (user?.role === 'worker') {
    return (
      <div className="text-center py-12 bg-white rounded-lg">
        <p className="text-gray-500">You don't have access to invoices.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-gray-600 text-sm">Manage customer invoices</p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            onExportCSV={handleExportCSV}
            onExportExcel={handleExportExcel}
            filename={formatExportFilename('Invoices')}
            rowCount={filteredInvoices.length}
          />
          <Link to="/invoices/recurring" className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Recurring
          </Link>
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              {showForm ? 'Cancel' : '+ Create Invoice'}
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Outstanding</p>
          <p className="text-2xl font-bold text-orange-600">£{summary.outstanding.toFixed(2)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Overdue</p>
          <p className="text-2xl font-bold text-red-600">£{summary.overdue.toFixed(2)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Paid This Month</p>
          <p className="text-2xl font-bold text-green-600">£{summary.paidThisMonth.toFixed(2)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Drafts</p>
          <p className="text-2xl font-bold text-gray-600">{summary.drafts}</p>
        </div>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2 mb-6">
        {['all', 'draft', 'sent', 'paid', 'overdue'].map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              statusFilter === status ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Create Invoice Form */}
      {showForm && canEdit && (
        <div className="bg-white p-6 rounded-lg border mb-6">
          <h3 className="font-medium mb-4">New Invoice</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Customer *</label>
              <select
                value={invoice.customer_id}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">Select customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Route (optional)</label>
              <select
                value={invoice.route_id}
                onChange={(e) => setInvoice({...invoice, route_id: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">None</option>
                {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Issue Date</label>
              <input
                type="date"
                value={invoice.issue_date}
                onChange={(e) => setInvoice({...invoice, issue_date: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payment Terms</label>
              <select
                value={invoice.due_date}
                onChange={(e) => setInvoice({...invoice, due_date: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value={getDefaultDueDate(7)}>7 days</option>
                <option value={getDefaultDueDate(14)}>14 days</option>
                <option value={getDefaultDueDate(30)}>30 days</option>
                <option value="">Custom</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <h4 className="font-medium mb-2">Line Items</h4>
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  placeholder="Description"
                  value={item.description}
                  onChange={(e) => updateItem(i, 'description', e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg"
                />
                <input
                  type="number"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                  className="w-16 px-3 py-2 border rounded-lg"
                />
                <input
                  type="number"
                  placeholder="£"
                  value={item.unit_price}
                  onChange={(e) => updateItem(i, 'unit_price', e.target.value)}
                  className="w-24 px-3 py-2 border rounded-lg"
                />
                <input
                  type="number"
                  placeholder="VAT %"
                  value={item.vat_rate}
                  onChange={(e) => updateItem(i, 'vat_rate', e.target.value)}
                  className="w-16 px-3 py-2 border rounded-lg"
                />
                <span className="px-3 py-2">£{item.line_total.toFixed(2)}</span>
                {items.length > 1 && (
                  <button onClick={() => removeItem(i)} className="text-red-500">✕</button>
                )}
              </div>
            ))}
            <button onClick={addItem} className="text-blue-600 text-sm">+ Add Item</button>
          </div>

          <div className="mt-4 border-t pt-4">
            <div className="flex justify-between"><span>Subtotal:</span><span>£{totals.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>VAT:</span><span>£{totals.vat_amount.toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-lg"><span>Total:</span><span>£{totals.total.toFixed(2)}</span></div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={invoice.notes}
              onChange={(e) => setInvoice({...invoice, notes: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg"
              rows={2}
            />
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={saving || !invoice.customer_id} className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
          </div>
        </div>
      )}

      {/* Invoice List */}
      {filteredInvoices.length === 0 ? (
        <EmptyStateInvoices 
          hasInvoices={statusFilter !== 'all' || !!searchQuery} 
          onClearFilters={() => { setStatusFilter('all'); setSearchQuery(''); }}
        />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Invoice</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Issue Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Due Date</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Total</th>
                <th className="px-4 py-3 text-center text-sm font-medium">Status</th>
                <th className="px-4 py-3 text-center text-sm font-medium" title="Xero sync status">Xero</th>
                <th className="px-4 py-3 text-center text-sm font-medium" title="QuickBooks sync status">QBO</th>
                <th className="px-4 py-3 text-center text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredInvoices.map(inv => {
                const daysOverdue = getDaysOverdue(inv.due_date)
                return (
                  <tr 
                    key={inv.id} 
                    className={`hover:bg-gray-50 ${daysOverdue >= 30 ? 'bg-red-50' : daysOverdue >= 60 ? 'bg-red-100' : ''}`}
                    onClick={() => handleViewInvoice(inv)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium">{inv.invoice_number}</span>
                      {daysOverdue > 0 && (
                        <span className="ml-2 text-xs text-red-600">{daysOverdue} days overdue</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{inv.customers?.name}</td>
                    <td className="px-4 py-3 text-sm">{inv.issue_date}</td>
                    <td className="px-4 py-3 text-sm">{inv.due_date || '-'}</td>
                    <td className="px-4 py-3 text-right font-medium">£{(inv.total || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(inv.status)}`}>{inv.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.xero_invoice_id ? (
                        <button
                          onClick={() => window.open(`https://go.xero.com/Books/Report?id=Invoice&invoiceID=${inv.xero_invoice_id}`, '_blank')}
                          className="text-green-600 text-xs hover:underline"
                          title={`Synced ${inv.xero_synced_at ? new Date(inv.xero_synced_at).toLocaleString() : ''}`}
                        >✓</button>
                      ) : inv.xero_sync_status === 'error' ? (
                        <span className="text-red-600 text-xs" title={inv.xero_sync_error || 'Error'}>⚠</span>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.qbo_invoice_id ? (
                        <button
                          onClick={() => window.open(`https://app.quickbooks.com/`, '_blank')}
                          className="text-green-600 text-xs hover:underline"
                          title={`Synced ${inv.qbo_synced_at ? new Date(inv.qbo_synced_at).toLocaleString() : ''}`}
                        >✓</button>
                      ) : inv.qbo_sync_status === 'error' ? (
                        <span className="text-red-600 text-xs" title={inv.qbo_sync_error || 'Error'}>⚠</span>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleDownloadPDF(inv)} className="text-blue-600 text-sm mr-2">PDF</button>
                      {canEdit && inv.status !== 'cancelled' && inv.status !== 'paid' && (
                        <button onClick={() => handleSendEmail(inv)} className="text-green-600 text-sm mr-2">Email</button>
                      )}
                      {canEdit && inv.status !== 'cancelled' && (
                        <button onClick={() => handleDelete(inv.id)} className="text-red-500 text-sm">Delete</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xl font-bold">{selectedInvoice.invoice_number}</h2>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(selectedInvoice.status)}`}>
                    {selectedInvoice.status}
                  </span>
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="text-gray-500">✕ Close</button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500">Customer</p>
                  <p className="font-medium">{selectedInvoice.customers?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Route</p>
                  <p className="font-medium">{selectedInvoice.routes?.name || 'None'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Issue Date</p>
                  <p>{selectedInvoice.issue_date}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Due Date</p>
                  <p>{selectedInvoice.due_date || 'Not set'}</p>
                </div>
              </div>

              {/* Xero Sync Section */}
              <div className="mb-4 p-3 border rounded-lg">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Xero</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      selectedInvoice.xero_sync_status === 'synced' ? 'bg-green-100 text-green-700' :
                      selectedInvoice.xero_sync_status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {selectedInvoice.xero_sync_status === 'synced' ? 'Synced' :
                       selectedInvoice.xero_sync_status === 'error' ? 'Error' : 'Not synced'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {selectedInvoice.xero_invoice_id && (
                      <button
                        onClick={() => window.open(`https://go.xero.com/Books/Report?id=Invoice&invoiceID=${selectedInvoice.xero_invoice_id}`, '_blank')}
                        className="text-sm px-3 py-1 text-gray-600 hover:text-gray-800"
                      >
                        View in Xero
                      </button>
                    )}
                    {canEdit && selectedInvoice.status !== 'draft' && (
                      <button
                        onClick={async () => {
                          try {
                            const connection = await getXeroConnection(user.id)
                            if (!connection) {
                              alert('Please connect to Xero in Settings first')
                              return
                            }
                            const result = await syncInvoiceToXero(selectedInvoice.id, user.id)
                            if (result.success) {
                              alert('Synced to Xero successfully!')
                              fetchInvoices()
                              handleViewInvoice({ ...selectedInvoice, xero_sync_status: 'synced', xero_synced_at: new Date().toISOString() })
                            } else {
                              alert('Sync failed: ' + result.error)
                            }
                          } catch (err) {
                            alert('Sync failed: ' + err.message)
                          }
                        }}
                        className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Sync to Xero
                      </button>
                    )}
                  </div>
                </div>
                {selectedInvoice.xero_synced_at && (
                  <p className="text-xs text-gray-500 mt-1">
                    Last synced: {new Date(selectedInvoice.xero_synced_at).toLocaleString()}
                  </p>
                )}
                {selectedInvoice.xero_sync_error && (
                  <p className="text-xs text-red-600 mt-1">
                    Error: {selectedInvoice.xero_sync_error}
                  </p>
                )}
              </div>

              {/* QuickBooks Sync Section */}
              <div className="mb-4 p-3 border rounded-lg">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">QuickBooks</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      selectedInvoice.qbo_sync_status === 'synced' ? 'bg-green-100 text-green-700' :
                      selectedInvoice.qbo_sync_status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {selectedInvoice.qbo_sync_status === 'synced' ? 'Synced' :
                       selectedInvoice.qbo_sync_status === 'error' ? 'Error' : 'Not synced'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {selectedInvoice.qbo_invoice_id && (
                      <button
                        onClick={() => window.open(`https://quickbooks.intuit.com/redirect/`, '_blank')}
                        className="text-sm px-3 py-1 text-gray-600 hover:text-gray-800"
                      >
                        View in QuickBooks
                      </button>
                    )}
                    {canEdit && selectedInvoice.status !== 'draft' && (
                      <button
                        onClick={async () => {
                          try {
                            const connection = await getQuickBooksConnection(user.id)
                            if (!connection) {
                              alert('Please connect to QuickBooks in Settings first')
                              return
                            }
                            const result = await syncInvoiceToQBO(selectedInvoice.id, user.id)
                            if (result.success) {
                              alert('Synced to QuickBooks successfully!')
                              fetchInvoices()
                              handleViewInvoice({ ...selectedInvoice, qbo_sync_status: 'synced', qbo_synced_at: new Date().toISOString() })
                            } else {
                              alert('Sync failed: ' + result.error)
                            }
                          } catch (err) {
                            alert('Sync failed: ' + err.message)
                          }
                        }}
                        className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Sync to QBO
                      </button>
                    )}
                  </div>
                </div>
                {selectedInvoice.qbo_synced_at && (
                  <p className="text-xs text-gray-500 mt-1">
                    Last synced: {new Date(selectedInvoice.qbo_synced_at).toLocaleString()}
                  </p>
                )}
                {selectedInvoice.qbo_sync_error && (
                  <p className="text-xs text-red-600 mt-1">
                    Error: {selectedInvoice.qbo_sync_error}
                  </p>
                )}
              </div>

              {/* Line Items */}
              <div className="mb-6">
                <h4 className="font-medium mb-2">Line Items</h4>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2">Description</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Price</th>
                      <th className="text-right py-2">VAT</th>
                      <th className="text-right py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedInvoice.line_items || []).map((item, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-2">{item.description}</td>
                        <td className="text-right">{item.quantity}</td>
                        <td className="text-right">£{item.unit_price.toFixed(2)}</td>
                        <td className="text-right">{item.vat_rate}%</td>
                        <td className="text-right">£{item.line_total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t">
                    <tr><td colSpan={4} className="text-right py-2">Subtotal:</td><td className="text-right">£{selectedTotals.subtotal.toFixed(2)}</td></tr>
                    <tr><td colSpan={4} className="text-right py-2">VAT:</td><td className="text-right">£{selectedTotals.vat_amount.toFixed(2)}</td></tr>
                    <tr className="font-bold"><td colSpan={4} className="text-right py-2">Total:</td><td className="text-right">£{selectedTotals.total.toFixed(2)}</td></tr>
                  </tfoot>
                </table>
              </div>

              {/* Status Actions */}
              {canEdit && selectedInvoice.status === 'draft' && (
                <button onClick={() => handleStatusChange(selectedInvoice.id, 'sent')} className="px-4 py-2 bg-blue-600 text-white rounded-lg mr-2">
                  Mark as Sent
                </button>
              )}
              {canEdit && selectedInvoice.status !== 'paid' && (
                <button onClick={() => setShowPaymentForm(true)} className="px-4 py-2 bg-green-600 text-white rounded-lg">
                  Record Payment
                </button>
              )}

              {/* Payment Form */}
              {showPaymentForm && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <h4 className="font-medium mb-2">Record Payment</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs">Amount</label>
                      <input
                        type="number"
                        value={newPayment.amount}
                        onChange={(e) => setNewPayment({...newPayment, amount: Number(e.target.value)})}
                        className="w-full px-2 py-1 border rounded"
                      />
                    </div>
                    <div>
                      <label className="text-xs">Date</label>
                      <input
                        type="date"
                        value={newPayment.payment_date}
                        onChange={(e) => setNewPayment({...newPayment, payment_date: e.target.value})}
                        className="w-full px-2 py-1 border rounded"
                      />
                    </div>
                    <div>
                      <label className="text-xs">Method</label>
                      <select
                        value={newPayment.method}
                        onChange={(e) => setNewPayment({...newPayment, method: e.target.value})}
                        className="w-full px-2 py-1 border rounded"
                      >
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="direct_debit">Direct Debit</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="card">Card</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs">Reference</label>
                      <input
                        value={newPayment.reference}
                        onChange={(e) => setNewPayment({...newPayment, reference: e.target.value})}
                        className="w-full px-2 py-1 border rounded"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={handleAddPayment} className="px-3 py-1 bg-green-600 text-white rounded">Save Payment</button>
                    <button onClick={() => setShowPaymentForm(false)} className="px-3 py-1 bg-gray-200 rounded">Cancel</button>
                  </div>
                </div>
              )}

              {/* Payment History */}
              {payments.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-medium mb-2">Payment History</h4>
                  <div className="space-y-2">
                    {payments.map(p => (
                      <div key={p.id} className="flex justify-between text-sm p-2 bg-gray-50 rounded">
                        <span>{p.payment_date} - {p.method}</span>
                        <span className="font-medium">£{p.amount.toFixed(2)}</span>
                        {p.reference && <span className="text-gray-500">{p.reference}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}