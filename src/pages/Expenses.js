import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import ExportButton from '../components/ExportButton'
import { exportToCSV, exportToExcel, EXPENSE_COLUMNS, formatExportFilename } from '../lib/exportUtils'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'
import { SkeletonTable } from '../components/SkeletonComponents'
import { EmptyStateExpenses } from '../components/EmptyStates'
import { scanReceipt, uploadReceipt } from '../lib/receiptScanner'
import { showSuccessToast, showErrorToast } from '../lib/errorHandling'

export default function Expenses({ user }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('')
  
  const [expenseForm, setExpenseForm] = useState({
    description: '',
    category: 'supplies',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    vat_reclaimable: false,
    vat_amount: '',
    supplier: '',
    receipt_url: ''
  })
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptPreview, setReceiptPreview] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scannedData, setScannedData] = useState(null)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [viewingReceipt, setViewingReceipt] = useState(null)
  const [batchScanning, setBatchScanning] = useState(false)
  const [batchFiles, setBatchFiles] = useState([])
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, results: [] })
  const fileInputRef = useRef(null)
  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const canBatchScan = user?.role === 'admin' || user?.role === 'manager'

  const handleExportCSV = () => {
    const data = filteredExpenses.map(e => ({
      expense_date: e.expense_date,
      description: e.description,
      category: e.category,
      supplier: e.supplier || '',
      amount: e.amount,
      vat_reclaimable: e.vat_reclaimable,
      vat_amount: e.vat_amount || 0,
      net_amount: e.amount - (e.vat_amount || 0),
      has_receipt: !!e.receipt_url
    }))
    exportToCSV(data, formatExportFilename('Expenses'), EXPENSE_COLUMNS)
  }

  const handleExportExcel = () => {
    const data = filteredExpenses.map(e => ({
      expense_date: e.expense_date,
      description: e.description,
      category: e.category,
      supplier: e.supplier || '',
      amount: e.amount,
      vat_reclaimable: e.vat_reclaimable,
      vat_amount: e.vat_amount || 0,
      net_amount: e.amount - (e.vat_amount || 0),
      has_receipt: !!e.receipt_url
    }))
    exportToExcel(data, formatExportFilename('Expenses'), EXPENSE_COLUMNS, 'Expenses')
  }

  useEffect(() => {
    loadExpenses()
  }, [])

  async function loadExpenses() {
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('*, xero_bill_id, xero_synced_at, qbo_bill_id, qbo_synced_at')
      .order('expense_date', { ascending: false })
    
    if (data) setExpenses(data)
    setLoading(false)
  }

  async function handleReceiptSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = () => setReceiptPreview(reader.result)
    reader.readAsDataURL(file)
    
    setReceiptFile(file)
    setScanning(true)
    setScannedData(null)
    setHasReviewed(false)
    
    try {
      const result = await scanReceipt(file)
      
      if (result.error) {
        showErrorToast('Scan Failed', result.error)
      } else if (result.data) {
        setScannedData(result.data)
        
        if (result.data.supplier) {
          setExpenseForm(prev => ({ ...prev, supplier: result.data.supplier }))
        }
        if (result.data.date) {
          const parts = result.data.date.split('/')
          if (parts.length === 3) {
            setExpenseForm(prev => ({ ...prev, expense_date: `${parts[2]}-${parts[1]}-${parts[0]}` }))
          }
        }
        if (result.data.total_amount) {
          setExpenseForm(prev => ({ ...prev, amount: result.data.total_amount.toString() }))
        }
        if (result.data.vat_amount) {
          setExpenseForm(prev => ({ ...prev, vat_amount: result.data.vat_amount }))
        }
        if (result.data.category) {
          setExpenseForm(prev => ({ ...prev, category: result.data.category }))
        }
        if (result.data.description) {
          setExpenseForm(prev => ({ ...prev, description: result.data.description }))
        }
        if (result.data.vat_reclaimable !== undefined) {
          setExpenseForm(prev => ({ ...prev, vat_reclaimable: result.data.vat_reclaimable }))
        }
        
        showSuccessToast('Receipt Scanned', 'Please review the extracted details before saving')
      }
    } catch (err) {
      console.error('Scan error:', err)
      showErrorToast('Scan Failed', 'Could not scan receipt. Please enter details manually.')
    } finally {
      setScanning(false)
    }
  }

  function clearReceipt() {
    setReceiptFile(null)
    setReceiptPreview(null)
    setScannedData(null)
    setHasReviewed(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleReviewComplete() {
    setHasReviewed(true)
  }

  async function handleBatchReceiptSelect(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (files.length > 10) {
      showErrorToast('Limit Exceeded', 'Maximum 10 receipts at once')
      return
    }
    
    setBatchFiles(files)
    setBatchProgress({ current: 0, total: files.length, results: [] })
  }

  async function startBatchScan() {
    setBatchProgress(prev => ({ ...prev, current: 1 }))
    
    for (let i = 0; i < batchFiles.length; i++) {
      try {
        const result = await scanReceipt(batchFiles[i])
        setBatchProgress(prev => ({
          ...prev,
          current: i + 1,
          results: [...prev.results, { file: batchFiles[i].name, ...result }]
        }))
      } catch (err) {
        setBatchProgress(prev => ({
          ...prev,
          current: i + 1,
          results: [...prev.results, { file: batchFiles[i].name, error: err.message }]
        }))
      }
    }
  }

  async function saveBatchResult(result) {
    if (!result.data) return
    
    const expenseData = {
      description: result.data.description || result.file,
      category: result.data.category || 'other',
      amount: result.data.total_amount || 0,
      expense_date: new Date().toISOString().split('T')[0],
      vat_reclaimable: result.data.vat_reclaimable || false,
      vat_amount: result.data.vat_amount || 0,
      supplier: result.data.supplier || null
    }
    
    const { data } = await supabase.from('expenses').insert([expenseData]).select()
    
    if (result.file) {
      await uploadReceipt(result.file, user?.id, data?.[0]?.id)
    }
    
    logAuditEvent(
      AUDIT_ACTIONS.EXPENSE_CREATED,
      'expense',
      data?.[0]?.id,
      expenseData.description,
      null,
      expenseData
    )
  }

  function clearBatchScan() {
    setBatchScanning(false)
    setBatchFiles([])
    setBatchProgress({ current: 0, total: 0, results: [] })
  }

  async function handleSave() {
    if (!expenseForm.description || !expenseForm.amount) return
    
    if (!hasReviewed && scannedData) {
      showErrorToast('Review Required', 'Please review the scanned details before saving')
      return
    }
    
    const expenseData = {
      description: expenseForm.description,
      category: expenseForm.category,
      amount: parseFloat(expenseForm.amount),
      expense_date: expenseForm.expense_date,
      vat_reclaimable: expenseForm.vat_reclaimable,
      vat_amount: expenseForm.vat_reclaimable ? parseFloat(expenseForm.amount) * 0.2 : 0,
      supplier: expenseForm.supplier || null,
      receipt_url: expenseForm.receipt_url || null
    }
    
    let savedExpenseId = editingExpense
    
    if (editingExpense) {
      const oldExpense = expenses.find(e => e.id === editingExpense)
      await supabase.from('expenses').update(expenseData).eq('id', editingExpense)
      
      logAuditEvent(
        AUDIT_ACTIONS.EXPENSE_UPDATED,
        'expense',
        editingExpense,
        expenseData.description,
        oldExpense,
        expenseData
      )
    } else {
      const { data } = await supabase.from('expenses').insert([expenseData]).select()
      savedExpenseId = data?.[0]?.id
      
      logAuditEvent(
        AUDIT_ACTIONS.EXPENSE_CREATED,
        'expense',
        savedExpenseId,
        expenseData.description,
        null,
        expenseData
      )
    }
    
    if (receiptFile && savedExpenseId) {
      await uploadReceipt(receiptFile, user?.id, savedExpenseId)
    }
    
    setExpenseForm({
      description: '',
      category: 'supplies',
      amount: '',
      expense_date: new Date().toISOString().split('T')[0],
      vat_reclaimable: false,
      supplier: '',
      receipt_url: ''
    })
    setEditingExpense(null)
    setShowForm(false)
    clearReceipt()
    loadExpenses()
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this expense?')) return
    const expense = expenses.find(e => e.id === id)
    await supabase.from('expenses').delete().eq('id', id)
    loadExpenses()
    
    logAuditEvent(
      AUDIT_ACTIONS.EXPENSE_DELETED,
      'expense',
      id,
      expense?.description,
      expense,
      null
    )
  }

  function handleEdit(expense) {
    setEditingExpense(expense.id)
    setExpenseForm({
      description: expense.description,
      category: expense.category,
      amount: expense.amount.toString(),
      expense_date: expense.expense_date,
      vat_reclaimable: expense.vat_reclaimable,
      supplier: expense.supplier || '',
      receipt_url: expense.receipt_url || ''
    })
    setShowForm(true)
  }

  const getFilteredExpenses = () => {
    let filtered = [...expenses]
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(e => e.category === categoryFilter)
    }
    if (monthFilter) {
      filtered = filtered.filter(e => e.expense_date?.startsWith(monthFilter))
    }
    return filtered
  }

  const filteredExpenses = getFilteredExpenses()
  const total = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const vatReclaimable = filteredExpenses.filter(e => e.vat_reclaimable).reduce((sum, e) => sum + Number(e.vat_amount || 0), 0)

  const getCategoryBadge = (category) => {
    switch(category) {
      case 'fuel': return 'bg-orange-100 text-orange-800'
      case 'equipment': return 'bg-blue-100 text-blue-800'
      case 'supplies': return 'bg-purple-100 text-purple-800'
      case 'insurance': return 'bg-green-100 text-green-800'
      case 'vehicle': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (user?.role === 'worker') {
    return (
      <div className="text-center py-12 bg-white rounded-lg">
        <p className="text-gray-500">You don't have access to expenses.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-gray-600 text-sm">Track business expenses</p>
        </div>
        <ExportButton
          onExportCSV={handleExportCSV}
          onExportExcel={handleExportExcel}
          filename={formatExportFilename('Expenses')}
          rowCount={filteredExpenses.length}
        />
        {canBatchScan && (
          <button onClick={() => setBatchScanning(true)} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
            Scan Multiple
          </button>
        )}
        {canEdit && (
          <button onClick={() => {
            setEditingExpense(null)
            setExpenseForm({
              description: '',
              category: 'supplies',
              amount: '',
              expense_date: new Date().toISOString().split('T')[0],
              vat_reclaimable: false,
              vat_amount: '',
              supplier: '',
              receipt_url: ''
            })
            clearReceipt()
            setShowForm(!showForm)
          }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            {showForm ? 'Cancel' : '+ Add Expense'}
          </button>
        )}
      </div>

      <div className="flex gap-4 mb-6">
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 border rounded-lg">
          <option value="all">All Categories</option>
          <option value="fuel">Fuel</option>
          <option value="equipment">Equipment</option>
          <option value="supplies">Supplies</option>
          <option value="insurance">Insurance</option>
          <option value="vehicle">Vehicle</option>
          <option value="other">Other</option>
        </select>
        <input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="px-3 py-2 border rounded-lg" />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Total Expenses</p>
          <p className="text-2xl font-bold">£{total.toFixed(2)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">VAT Reclaimable</p>
          <p className="text-2xl font-bold text-green-600">£{vatReclaimable.toFixed(2)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Net Cost</p>
          <p className="text-2xl font-bold text-blue-600">£{(total - vatReclaimable).toFixed(2)}</p>
        </div>
      </div>

      {showForm && !editingExpense && (
        <div className="bg-white p-6 rounded-lg border mb-6">
          <h3 className="text-lg font-medium mb-4">Scan Receipt</h3>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleReceiptSelect}
            className="hidden"
          />
          
          {!receiptPreview ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
            >
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 10-6 0 3 3 0 006 0z" />
              </svg>
              <p className="text-gray-600 mb-1">Tap to photograph receipt</p>
              <p className="text-sm text-gray-400">or drag and drop an image</p>
            </div>
          ) : (
            <div className="relative">
              <img src={receiptPreview} alt="Receipt preview" className="max-h-64 mx-auto rounded-lg" />
              
              {scanning ? (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                  <div className="text-white text-center">
                    <svg className="animate-spin w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <p>Scanning receipt...</p>
                  </div>
                </div>
              ) : (
                <button onClick={clearReceipt} className="absolute top-2 right-2 p-1 bg-gray-800/70 rounded-full text-white">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              
              {scannedData && !scanning && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 mb-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-medium">Receipt scanned successfully</span>
                  </div>
                  <button 
                    onClick={handleReviewComplete}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Mark as reviewed
                  </button>
                </div>
              )}
            </div>
          )}
          
          <p className="text-xs text-gray-400 mt-3">For best results: flat surface, good lighting, all four corners visible</p>
        </div>
      )}

      {showForm && (
        <div className="bg-white p-6 rounded-lg border mb-6">
          <h2 className="text-lg font-semibold mb-4">{editingExpense ? 'Edit Expense' : 'Add Expense'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="e.g. Window cleaning supplies" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                <option value="supplies">Supplies</option>
                <option value="equipment">Equipment</option>
                <option value="fuel">Fuel</option>
                <option value="vehicle">Vehicle</option>
                <option value="insurance">Insurance</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input type="number" step="0.01" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date</label>
              <input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({...expenseForm, expense_date: e.target.value})} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Supplier</label>
              <input type="text" value={expenseForm.supplier} onChange={e => setExpenseForm({...expenseForm, supplier: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="e.g. Amazon" />
            </div>
          </div>
          <div className="mt-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={expenseForm.vat_reclaimable} onChange={e => setExpenseForm({...expenseForm, vat_reclaimable: e.target.checked})} />
              <span className="text-sm">VAT Reclaimable (20%)</span>
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button 
            onClick={handleSave} 
            disabled={!hasReviewed && scannedData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!hasReviewed && scannedData ? 'Please review scanned details before saving' : ''}
          >
            {editingExpense ? 'Update' : 'Save'} Expense
          </button>
          {!hasReviewed && scannedData && (
            <p className="text-xs text-amber-600 mt-1">Please review scanned details before saving</p>
          )}
            {editingExpense && (
              <button onClick={() => { setEditingExpense(null); setShowForm(false) }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={8} />
      ) : filteredExpenses.length === 0 ? (
        <EmptyStateExpenses />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Description</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Supplier</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Category</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Amount</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">VAT</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Receipt</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500" title="Xero sync">
                  <button onClick={() => window.open('https://go.xero.com/', '_blank')} className="hover:text-blue-600">Xero</button>
                </th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500" title="QuickBooks sync">
                  <button onClick={() => window.open('https://app.quickbooks.com/', '_blank')} className="hover:text-blue-600">QBO</button>
                </th>
                {canEdit && <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredExpenses.map(expense => (
                <tr key={expense.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{expense.expense_date}</td>
                  <td className="px-4 py-3 text-sm">{expense.description}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{expense.supplier || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${getCategoryBadge(expense.category)}`}>{expense.category}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium">£{Number(expense.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    {expense.vat_reclaimable ? (
                      <span className="text-xs text-green-600">£{(expense.vat_amount || 0).toFixed(2)}</span>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {expense.receipt_url ? (
                      <button 
                        onClick={() => setViewingReceipt(expense.receipt_url)}
                        className="text-blue-600 hover:text-blue-800"
                        title="View receipt"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </button>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {expense.xero_bill_id ? (
                      <button
                        onClick={() => window.open('https://go.xero.com/Bills/Edit/' + expense.xero_bill_id, '_blank')}
                        className="text-green-600 text-xs hover:underline"
                        title={`Synced ${expense.xero_synced_at ? new Date(expense.xero_synced_at).toLocaleString() : ''}\nClick to view in Xero`}
                      >✓</button>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            const { data } = await supabase.functions.invoke('xero-sync-expense', { body: { expenseId: expense.id, userId: user.id } })
                            if (data?.success) loadExpenses()
                            alert(data?.success ? 'Synced to Xero!' : data?.error || 'Failed')
                          } catch (err) { alert(err.message) }
                        }}
                        className="text-gray-400 text-xs hover:text-green-600"
                        title="Click to sync to Xero"
                      >-</button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {expense.qbo_bill_id ? (
                      <button
                        onClick={() => window.open('https://app.quickbooks.com/', '_blank')}
                        className="text-green-600 text-xs hover:underline"
                        title={`Synced ${expense.qbo_synced_at ? new Date(expense.qbo_synced_at).toLocaleString() : ''}\nClick to view in QuickBooks`}
                      >✓</button>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            const { data } = await supabase.functions.invoke('qbo-sync-expense', { body: { expenseId: expense.id, userId: user.id } })
                            if (data?.success) loadExpenses()
                            alert(data?.success ? 'Synced to QuickBooks!' : data?.error || 'Failed')
                          } catch (err) { alert(err.message) }
                        }}
                        className="text-gray-400 text-xs hover:text-green-600"
                        title="Click to sync to QuickBooks"
                      >-</button>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleEdit(expense)} className="text-blue-600 text-sm mr-2">Edit</button>
                      <button onClick={() => handleDelete(expense.id)} className="text-red-500 text-sm">Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Receipt Modal */}
      {viewingReceipt && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewingReceipt(null)}>
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">Receipt</h3>
              <button onClick={() => setViewingReceipt(null)} className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <img src={viewingReceipt} alt="Receipt" className="max-w-full mx-auto" />
            </div>
          </div>
        </div>
      )}

      {/* Batch Scan Modal */}
      {batchScanning && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={clearBatchScan}>
          <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">Scan Multiple Receipts</h3>
              <button onClick={clearBatchScan} className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4">
              {batchProgress.total === 0 ? (
                <div>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleBatchReceiptSelect}
                    className="hidden"
                    id="batch-files"
                  />
                  <label htmlFor="batch-files" className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-600">Select up to 10 receipt images</p>
                  </label>
                  
                  {batchFiles.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm mb-2">{batchFiles.length} files selected</p>
                      <button onClick={startBatchScan} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg">
                        Scan {batchFiles.length} Receipts
                      </button>
                    </div>
                  )}
                </div>
              ) : batchProgress.current < batchProgress.total ? (
                <div className="text-center py-8">
                  <svg className="animate-spin w-8 h-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <p>Scanning {batchProgress.current} of {batchProgress.total}...</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium mb-4">Scan Complete</p>
                  {batchProgress.results.map((result, idx) => (
                    <div key={idx} className={`p-3 border rounded-lg mb-2 flex justify-between items-center ${result.error ? 'bg-red-50' : 'bg-green-50'}`}>
                      <div>
                        <p className="text-sm font-medium">{result.file}</p>
                        {result.error ? (
                          <p className="text-xs text-red-600">{result.error}</p>
                        ) : (
                          <p className="text-xs text-green-600">
                            {result.data?.supplier} - £{result.data?.total_amount}
                          </p>
                        )}
                      </div>
                      {!result.error && (
                        <button 
                          onClick={() => saveBatchResult(result)}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                        >
                          Save
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={clearBatchScan} className="w-full mt-4 px-4 py-2 bg-gray-100 rounded-lg">
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
