import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ENV = import.meta.env.VITE_HMRC_ENVIRONMENT || 'sandbox'

export default function VATReturnReport({ user }) {
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState(null)
  const [obligations, setObligations] = useState([])
  const [vatReturns, setVatReturns] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState(null)
  const [calculator, setCalculator] = useState({
    period_start: '',
    period_end: '',
    box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box8: 0, box9: 0
  })
  const [overrides, setOverrides] = useState({})
  const [sourceBreakdown, setSourceBreakdown] = useState({ invoices: [], expenses: [] })
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [settings, setSettings] = useState({})

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (calculator.period_start && calculator.period_end) {
      calculateBoxes()
    }
  }, [calculator.period_start, calculator.period_end])

  async function loadData() {
    setLoading(true)

    const [{ data: connData }, { data: vatData }, { data: settingsData }] = await Promise.all([
      supabase.from('hmrc_connections').select('*').eq('is_active', true).single(),
      supabase.from('vat_returns').select('*').order('period_end', { ascending: false }),
      supabase.from('company_settings').select('*').limit(1).single()
    ])

    if (connData) setConnection(connData)
    if (vatData) setVatReturns(vatData)
    if (settingsData) setSettings(settingsData)

    if (connData) {
      await loadObligations(connData.access_token, connData.vrn)
    }

    setLoading(false)
  }

  async function loadObligations(accessToken, vrn) {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmrc-get-obligations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, vrn })
      })

      const data = await response.json()
      if (data.obligations) {
        setObligations(data.obligations)
      }
    } catch (err) {
      console.error('Failed to load obligations:', err)
    }
  }

  async function calculateBoxes() {
    const scheme = settings.vat_accounting_scheme || 'cash'
    const start = calculator.period_start
    const end = calculator.period_end

    if (!start || !end) return

    let box1 = 0, box4 = 0, box6 = 0, box7 = 0

    if (scheme === 'cash') {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, paid_at, total_amount, vat_amount')
        .eq('status', 'paid')
        .gte('paid_at', start)
        .lte('paid_at', end)

      if (invoices) {
        box1 = invoices.reduce((s, i) => s + (parseFloat(i.vat_amount) || 0), 0)
        box6 = invoices.reduce((s, i) => s + (parseFloat(i.total_amount) - parseFloat(i.vat_amount) || 0), 0)
      }

      const { data: expenses } = await supabase
        .from('expenses')
        .select('id, expense_date, paid_at, amount, vat_amount, vat_reclaimable')
        .eq('status', 'paid')
        .eq('vat_reclaimable', true)
        .gte('paid_at', start)
        .lte('paid_at', end)

      if (expenses) {
        box4 = expenses.reduce((s, e) => s + (parseFloat(e.vat_amount) || 0), 0)
        box7 = expenses.reduce((s, e) => s + (parseFloat(e.amount) - parseFloat(e.vat_amount) || 0), 0)
      }

      setSourceBreakdown({ invoices: invoices || [], expenses: expenses || [] })
    } else {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, total_amount, vat_amount')
        .in('status', ['sent', 'paid'])
        .gte('issue_date', start)
        .lte('issue_date', end)

      if (invoices) {
        box1 = invoices.reduce((s, i) => s + (parseFloat(i.vat_amount) || 0), 0)
        box6 = invoices.reduce((s, i) => s + (parseFloat(i.total_amount) - parseFloat(i.vat_amount) || 0), 0)
      }

      const { data: expenses } = await supabase
        .from('expenses')
        .select('id, expense_date, amount, vat_amount, vat_reclaimable')
        .in('status', ['approved', 'paid'])
        .eq('vat_reclaimable', true)
        .gte('expense_date', start)
        .lte('expense_date', end)

      if (expenses) {
        box4 = expenses.reduce((s, e) => s + (parseFloat(e.vat_amount) || 0), 0)
        box7 = expenses.reduce((s, e) => s + (parseFloat(e.amount) - parseFloat(e.vat_amount) || 0), 0)
      }

      setSourceBreakdown({ invoices: invoices || [], expenses: expenses || [] })
    }

    const box2 = 0
    const box3 = (overrides.box1 ?? box1) + box2
    const box5 = box3 - ((overrides.box4 ?? box4) || 0)
    const box8 = 0
    const box9 = 0

    setCalculator(prev => ({
      ...prev,
      box1: overrides.box1 ?? box1,
      box2,
      box3,
      box4: overrides.box4 ?? box4,
      box5,
      box6: overrides.box6 ?? box6,
      box7: overrides.box7 ?? box7,
      box8,
      box9
    }))
  }

  async function handleConnect() {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmrc-oauth-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vrn: settings.vat_registration_number })
      })

      const data = await response.json()
      if (data.authUrl) {
        window.location.href = data.authUrl
      }
    } catch (err) {
      setError('Failed to start OAuth flow')
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect from HMRC? You will need to reconnect to submit future returns.')) return

    await supabase
      .from('hmrc_connections')
      .update({ is_active: false })
      .eq('vrn', connection.vrn)

    setConnection(null)
  }

  async function handleRefreshObligations() {
    if (!connection) return

    const refreshResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmrc-refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    const tokenData = await refreshResp.json()
    if (tokenData.access_token) {
      await loadObligations(tokenData.access_token, connection.vrn)
    }
  }

  function selectObligation(obs) {
    setSelectedPeriod(obs)
    setCalculator(prev => ({
      ...prev,
      period_start: obs.periodStart,
      period_end: obs.periodEnd
    }))
  }

  function handleOverride(box, value) {
    setOverrides(prev => ({ ...prev, [box]: parseFloat(value) || 0 }))
    calculateBoxes()
  }

  async function handleSubmit(draft = false) {
    if (!connection || !selectedPeriod) {
      setError('Please select a VAT period first')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const refreshResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmrc-refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      const tokenData = await refreshResp.json()

      if (draft) {
        await supabase.from('vat_returns').insert([{
          period_key: selectedPeriod.periodKey,
          period_start: calculator.period_start,
          period_end: calculator.period_end,
          due_date: selectedPeriod.dueDate,
          status: 'draft',
          box_1: calculator.box1,
          box_2: calculator.box2,
          box_3: calculator.box3,
          box_4: calculator.box4,
          box_5: calculator.box5,
          box_6: calculator.box6,
          box_7: calculator.box7,
          box_8: calculator.box8,
          box_9: calculator.box9
        }])
        setSuccess('Draft saved successfully')
      } else {
        const submitResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmrc-submit-return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: tokenData.access_token,
            vrn: connection.vrn,
            periodKey: selectedPeriod.periodKey,
            box1: calculator.box1,
            box2: calculator.box2,
            box4: calculator.box4,
            box6: calculator.box6,
            box7: calculator.box7,
            box8: calculator.box8,
            box9: calculator.box9
          })
        })

        const result = await submitResp.json()
        
        if (result.error) {
          setError(result.error)
        } else {
          setSuccess(`VAT return submitted! Reference: ${result.submissionReference}`)
          loadData()
        }
      }
    } catch (err) {
      setError('Failed to submit: ' + err.message)
    }

    setSubmitting(false)
  }

  const formatMoney = (amount) => `£${(amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`

  const getStatusBadge = (status) => {
    const styles = {
      open: 'bg-yellow-100 text-yellow-800',
      fulfilled: 'bg-green-100 text-green-800',
      overdue: 'bg-red-100 text-red-800',
      submitted: 'bg-green-100 text-green-800',
      draft: 'bg-gray-100 text-gray-800'
    }
    return <span className={`px-2 py-1 rounded text-xs ${styles[status] || styles.open}`}>{status}</span>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const canSubmit = user?.role === 'admin'
  const canView = user?.role === 'admin' || user?.role === 'manager'

  if (!canView) {
    return <div className="p-8 text-center text-gray-500">You don't have access to VAT reports.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">VAT Return</h1>
          <p className="text-gray-500">Submit your VAT returns to HMRC Making Tax Digital</p>
        </div>
        {ENV === 'sandbox' && (
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">Sandbox Mode</span>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{success}</div>
      )}

      {/* Section 1: HMRC Connection */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold mb-4">HMRC Connection</h2>
        {connection ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-xl">✓</span>
              </div>
              <div>
                <p className="font-medium text-green-700">Connected to HMRC MTD</p>
                <p className="text-sm text-gray-500">VRN: {connection.vrn}</p>
                <p className="text-xs text-gray-400">Connected: {new Date(connection.connected_at).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleRefreshObligations} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                Refresh Obligations
              </button>
              <button onClick={handleDisconnect} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg">
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🏛️</span>
            </div>
            <h3 className="font-medium mb-2">Connect to HMRC Making Tax Digital</h3>
            <p className="text-gray-500 mb-4 text-sm">Submit your VAT returns directly to HMRC without leaving ClearRoute</p>
            {!settings.vat_registration_number ? (
              <p className="text-orange-600 text-sm mb-4">Please add your VAT Registration Number in Settings first.</p>
            ) : (
              <button onClick={handleConnect} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Connect to HMRC
              </button>
            )}
          </div>
        )}
      </div>

      {connection && (
        <>
          {/* Section 2: VAT Obligations */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold mb-4">VAT Obligations</h2>
            {obligations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Period</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Due Date</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obligations.map((obs, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-3 px-4">{obs.periodStart} to {obs.periodEnd}</td>
                        <td className="py-3 px-4">{obs.dueDate}</td>
                        <td className="py-3 px-4">{getStatusBadge(obs.status)}</td>
                        <td className="py-3 px-4">
                          {obs.status === 'open' && (
                            <button
                              onClick={() => selectObligation(obs)}
                              className="text-blue-600 hover:underline"
                            >
                              Calculate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No obligations found. Click Refresh to load.</p>
            )}
          </div>

          {/* Section 3: VAT Calculator */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold mb-4">VAT Return Calculator</h2>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period Start</label>
                <input
                  type="date"
                  value={calculator.period_start}
                  onChange={e => setCalculator({ ...calculator, period_start: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period End</label>
                <input
                  type="date"
                  value={calculator.period_end}
                  onChange={e => setCalculator({ ...calculator, period_end: e.target.value })}
                  className="input"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <VATBox number={1} label="VAT due on sales" value={calculator.box1} override={overrides.box1} onOverride={v => handleOverride('box1', v)} />
              <VATBox number={2} label="VAT due on EC acquisitions" value={calculator.box2} override={overrides.box2} onOverride={v => handleOverride('box2', v)} />
              <VATBox number={3} label="Total VAT due" value={calculator.box3} calculated />
              <VATBox number={4} label="VAT reclaimed" value={calculator.box4} override={overrides.box4} onOverride={v => handleOverride('box4', v)} />
              <VATBox number={5} label="Net VAT payable" value={calculator.box5} highlight />
              <VATBox number={6} label="Total value of sales (ex VAT)" value={calculator.box6} override={overrides.box6} onOverride={v => handleOverride('box6', v)} />
              <VATBox number={7} label="Total value of purchases (ex VAT)" value={calculator.box7} override={overrides.box7} onOverride={v => handleOverride('box7', v)} />
              <VATBox number={8} label="Total EC supplies" value={calculator.box8} override={overrides.box8} onOverride={v => handleOverride('box8', v)} />
              <VATBox number={9} label="Total EC acquisitions" value={calculator.box9} override={overrides.box9} onOverride={v => handleOverride('box9', v)} />
            </div>

            <button
              onClick={() => setShowBreakdown(true)}
              className="mt-4 text-blue-600 hover:underline text-sm"
            >
              View source breakdown ({sourceBreakdown.invoices.length} invoices, {sourceBreakdown.expenses.length} expenses)
            </button>
          </div>

          {/* Section 4: Submission */}
          {selectedPeriod && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-semibold mb-4">Submit to HMRC</h2>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-yellow-800 font-medium mb-2">Before submission checklist:</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>□ All invoices for this period have been raised</li>
                  <li>□ All expenses for this period have been recorded</li>
                  <li>□ You have reviewed all nine boxes</li>
                  <li>□ Your VAT number is correct: {connection.vrn}</li>
                </ul>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-gray-600">Declaration:</p>
                <p className="text-sm italic">"When you submit this VAT return, you are making a legal declaration that the information is true and complete. A false declaration can result in prosecution."</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleSubmit(true)}
                  disabled={submitting}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Save Draft
                </button>
                {canSubmit && (
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to submit this VAT return to HMRC? This cannot be undone.')) {
                        handleSubmit(false)
                      }
                    }}
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {submitting ? 'Submitting...' : 'Submit to HMRC'}
                  </button>
                )}
              </div>

              {!canSubmit && (
                <p className="text-sm text-gray-500 mt-2">Only admins can submit to HMRC.</p>
              )}
            </div>
          )}

          {/* Section 5: VAT Return History */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold mb-4">VAT Return History</h2>
            {vatReturns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Period</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Due Date</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Net VAT</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vatReturns.map((ret, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-3 px-4">{ret.period_start} to {ret.period_end}</td>
                        <td className="py-3 px-4">{ret.due_date}</td>
                        <td className="py-3 px-4">{formatMoney(ret.box_5)}</td>
                        <td className="py-3 px-4">{getStatusBadge(ret.status)}</td>
                        <td className="py-3 px-4 text-sm">{ret.submission_reference || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No VAT returns yet.</p>
            )}
          </div>
        </>
      )}

      {/* Source Breakdown Modal */}
      {showBreakdown && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Source Breakdown</h3>
              <button onClick={() => setShowBreakdown(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="mb-4">
              <h4 className="font-medium mb-2">Invoices ({sourceBreakdown.invoices.length})</h4>
              {sourceBreakdown.invoices.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Date</th>
                      <th className="text-left py-2">Reference</th>
                      <th className="text-right py-2">Amount</th>
                      <th className="text-right py-2">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceBreakdown.invoices.map((inv, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2">{inv.issue_date || inv.paid_at}</td>
                        <td className="py-2">{inv.invoice_number}</td>
                        <td className="py-2 text-right">{formatMoney(inv.total_amount)}</td>
                        <td className="py-2 text-right">{formatMoney(inv.vat_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500 text-sm">No invoices in this period.</p>
              )}
            </div>

            <div>
              <h4 className="font-medium mb-2">Expenses ({sourceBreakdown.expenses.length})</h4>
              {sourceBreakdown.expenses.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Date</th>
                      <th className="text-right py-2">Amount</th>
                      <th className="text-right py-2">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceBreakdown.expenses.map((exp, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2">{exp.expense_date || exp.paid_at}</td>
                        <td className="py-2 text-right">{formatMoney(exp.amount)}</td>
                        <td className="py-2 text-right">{formatMoney(exp.vat_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500 text-sm">No reclaimable expenses in this period.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VATBox({ number, label, value, override, onOverride, calculated, highlight }) {
  const formatMoney = (amount) => `£${(amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`

  return (
    <div className={`p-4 rounded-lg border ${highlight ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'}`}>
      <p className="text-sm text-gray-600">Box {number}</p>
      <p className="text-lg font-semibold mb-1">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? 'text-blue-700' : ''}`}>{formatMoney(value)}</p>
      {calculated && <p className="text-xs text-gray-400">Auto-calculated</p>}
      {!calculated && onOverride && (
        <div className="mt-2">
          <input
            type="number"
            step="0.01"
            defaultValue={override ?? value}
            onBlur={e => onOverride(e.target.value)}
            className="input text-sm"
            placeholder="Manual override"
          />
          <p className="text-xs text-gray-500 mt-1">Manual override</p>
        </div>
      )}
    </div>
  )
}