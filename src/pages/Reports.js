import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Reports({ user }) {
  const [period, setPeriod] = useState('month')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [reportData, setReportData] = useState({ 
    revenue: 0, 
    expenses: 0, 
    profit: 0, 
    vatCollected: 0,
    vatReclaimable: 0,
    netVat: 0
  })
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState([])
  const [expenses, setExpenses] = useState([])

  useEffect(() => {
    loadReport()
  }, [period, dateRange])

  useEffect(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    setDateRange({
      start: start.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0]
    })
  }, [])

  async function loadReport() {
    setLoading(true)
    
    let startDate
    if (dateRange.start) {
      startDate = new Date(dateRange.start)
    } else {
      startDate = new Date()
      if (period === 'month') {
        startDate.setDate(1)
      } else if (period === 'quarter') {
        startDate.setMonth(startDate.getMonth() - 3)
        startDate.setDate(1)
      } else if (period === 'year') {
        startDate.setFullYear(startDate.getFullYear() - 1)
      }
    }
    
    const endDate = dateRange.end || new Date().toISOString().split('T')[0]
    
    const { data: invoiceData } = await supabase
      .from('invoices')
      .select('*')
      .gte('issue_date', startDate.toISOString().split('T')[0])
      .lte('issue_date', endDate)
    
    const { data: expenseData } = await supabase
      .from('expenses')
      .select('*')
      .gte('expense_date', startDate.toISOString().split('T')[0])
      .lte('expense_date', endDate)
    
    const paidInvoices = invoiceData?.filter(i => i.status === 'paid') || []
    const revenue = paidInvoices.reduce((sum, i) => sum + Number(i.total || 0), 0)
    const vatCollected = paidInvoices.reduce((sum, i) => sum + Number(i.vat_amount || 0), 0)
    const expenseTotal = expenseData?.reduce((sum, e) => sum + Number(e.amount || 0), 0) || 0
    const vatReclaimable = expenseData?.filter(e => e.vat_reclaimable).reduce((sum, e) => sum + Number(e.vat_amount || 0), 0) || 0
    
    setReportData({
      revenue,
      expenses: expenseTotal,
      profit: revenue - expenseTotal,
      vatCollected,
      vatReclaimable,
      netVat: vatCollected - vatReclaimable
    })
    
    setInvoices(paidInvoices)
    setExpenses(expenseData || [])
    setLoading(false)
  }

  const handleExportCSV = () => {
    const rows = [['Date', 'Description', 'Category/Invoice', 'Amount', 'VAT', 'Total']]
    
    invoices.forEach(inv => {
      rows.push([inv.issue_date, inv.invoice_number, 'Invoice', inv.total?.toFixed(2), inv.vat_amount?.toFixed(2), inv.total?.toFixed(2)])
    })
    
    expenses.forEach(exp => {
      rows.push([exp.expense_date, exp.description, exp.category, exp.amount?.toFixed(2), exp.vat_reclaimable ? exp.vat_amount?.toFixed(2) : '0.00', exp.amount?.toFixed(2)])
    })
    
    rows.push(['', '', 'Revenue', '', '', '', reportData.revenue?.toFixed(2)])
    rows.push(['', '', 'Expenses', '', '', reportData.expenses?.toFixed(2)])
    rows.push(['', '', 'Profit', '', '', '', reportData.profit?.toFixed(2)])
    
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  if (user?.role === 'worker') {
    return (
      <div className="text-center py-12 bg-white rounded-lg">
        <p className="text-gray-500">You don't have access to reports.</p>
      </div>
    )
  }

  if (loading) return <div className="text-center py-8">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-gray-600 text-sm">Profit & Loss and VAT summary</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportCSV} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            Export CSV
          </button>
        </div>
      </div>

      {/* Date Range */}
      <div className="flex gap-4 mb-6">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
          <option value="year">This Year</option>
          <option value="custom">Custom</option>
        </select>
        {period === 'custom' && (
          <>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
              className="px-3 py-2 border rounded-lg"
            />
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
              className="px-3 py-2 border rounded-lg"
            />
          </>
        )}
      </div>

      {/* P&L Summary */}
      <div className="bg-white p-6 rounded-lg border mb-6">
        <h2 className="text-lg font-bold mb-4">Profit & Loss</h2>
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">Revenue</p>
            <p className="text-2xl font-bold text-green-600">£{reportData.revenue.toFixed(2)}</p>
            <p className="text-xs text-gray-400">{invoices.length} invoices</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Expenses</p>
            <p className="text-2xl font-bold text-red-600">£{reportData.expenses.toFixed(2)}</p>
            <p className="text-xs text-gray-400">{expenses.length} expenses</p>
          </div>
          <div className="col-span-2 border-l pl-6">
            <p className="text-sm text-gray-500 mb-1">Gross Profit</p>
            <p className={`text-3xl font-bold ${reportData.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              £{reportData.profit.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* VAT Summary */}
      <div className="bg-white p-6 rounded-lg border">
        <h2 className="text-lg font-bold mb-4">VAT Summary</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">VAT Collected</p>
            <p className="text-2xl font-bold text-green-600">£{reportData.vatCollected.toFixed(2)}</p>
            <p className="text-xs text-gray-400">From invoices</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">VAT Reclaimable</p>
            <p className="text-2xl font-bold text-blue-600">£{reportData.vatReclaimable.toFixed(2)}</p>
            <p className="text-xs text-gray-400">From expenses</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Net VAT Liability</p>
            <p className={`text-2xl font-bold ${reportData.netVat >= 0 ? 'text-amber-600' : 'text-green-600'}`}>
              £{reportData.netVat.toFixed(2)}
            </p>
            <p className="text-xs text-gray-400">{reportData.netVat >= 0 ? 'To pay HMRC' : 'To reclaim'}</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-4">Based on {period === 'custom' ? 'custom' : period} period. Verify with accountant before submitting to HMRC.</p>
      </div>
    </div>
  )
}