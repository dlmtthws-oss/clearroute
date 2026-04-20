import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import GettingStartedChecklist from '../components/GettingStartedChecklist'

const COLORS = {
  draft: '#94A3B8',
  sent: '#3B82F6',
  paid: '#22C55E',
  overdue: '#EF4444',
  pending: '#F59E0B',
  inProgress: '#6366F1',
  completed: '#22C55E',
  notStarted: '#94A3B8'
}

export default function Dashboard({ user }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [kpis, setKpis] = useState({})
  const [todayRoutes, setTodayRoutes] = useState([])
  const [activeWorkers, setActiveWorkers] = useState([])
  const [outstandingInvoices, setOutstandingInvoices] = useState([])
  const [activity, setActivity] = useState([])
  const [financials, setFinancials] = useState({})
  const [invoiceBreakdown, setInvoiceBreakdown] = useState([])
  const [nextVatDue, setNextVatDue] = useState(null)
  const [xeroConnected, setXeroConnected] = useState(false)
  const [qboConnected, setQboConnected] = useState(false)

  useEffect(() => {
    async function checkConnections() {
      if (!user?.id) return
      const { data: xero } = await supabase.from('xero_connections').select('id').eq('user_id', user.id).eq('is_active', true).single()
      setXeroConnected(!!xero)
      const { data: qbo } = await supabase.from('quickbooks_connections').select('id').eq('user_id', user.id).eq('is_active', true).single()
      setQboConnected(!!qbo)
    }
    checkConnections()
  }, [user?.id])

  const isWorker = user?.role === 'worker'
  const isAdmin = user?.role === 'admin'

  async function loadDashboard() {
    if (isWorker) {
      await loadWorkerDashboard()
    } else {
      setRefreshing(true)
      await Promise.all([
        loadKPIs(),
        loadTodayRoutes(),
        loadActiveWorkers(),
        loadFinancials(),
        loadInvoiceBreakdown(),
        loadOutstandingInvoices(),
        loadActivity()
      ])
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadDashboard()
    const interval = setInterval(loadDashboard, 60000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isWorker) return
    
    const channel = supabase.channel('dashboard-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, 
        (payload) => {
          setActivity(prev => [payload.new, ...prev.slice(0, 19)])
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_sessions' },
        () => { loadTodayRoutes(); loadKPIs(); loadActiveWorkers() }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_executions' },
        () => { loadKPIs(); loadTodayRoutes() }
      )
      .subscribe()
    
    return () => supabase.removeChannel(channel)
  }, [isWorker])

  async function loadWorkerDashboard() {
    setLoading(true)
    const { data: workerData } = await supabase.from('workers').select('id, name').eq('email', user?.email).single()
    const wId = workerData?.id

    const today = new Date().toISOString().split('T')[0]
    
    const { data: sessions } = await supabase
      .from('route_sessions')
      .select('*, routes(name), workers(name)')
      .eq('worker_id', wId)
      .eq('date', today)
      .order('created_at')

    const { data: executions } = await supabase
      .from('job_executions')
      .select('*, route_sessions!inner(worker_id, date)')
      .eq('route_sessions.worker_id', wId)
      .eq('route_sessions.date', today)
      .eq('status', 'completed')

    const nextExecuted = await supabase
      .from('job_executions')
      .select('*, route_sessions!inner(worker_id, date), customers(name)')
      .eq('route_sessions.worker_id', wId)
      .eq('route_sessions.date', today)
      .in('status', ['pending', 'travelling', 'on_site'])
      .order('created_at')
      .limit(1)
      .single()

    setKpis({
      completedToday: executions?.length || 0,
      routesAssigned: sessions?.length || 0
    })
    setTodayRoutes(sessions || [])
    setActiveWorkers(nextExecuted?.data ? [{ ...nextExecuted.data, workers: workerData }] : [])
    setLoading(false)
  }

  async function loadKPIs() {
    const today = new Date().toISOString().split('T')[0]
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

    const [
      { data: jobsToday },
      { data: routesToday },
      { data: outstanding },
      { data: overdue },
      { data: revenueThisMonth },
      { data: revenueLastMonth },
      { data: activeWorkersData },
      { data: recurringTemplates }
    ] = await Promise.all([
      supabase.from('job_executions').select('id, status').then(r => ({ data: r.data })),
      supabase.from('route_sessions').select('*, routes(name), workers(name)').eq('date', today),
      supabase.from('invoices').select('id, total, status').in('status', ['sent', 'overdue']),
      supabase.from('invoices').select('id, total, due_date').eq('status', 'sent').lt('due_date', today),
      supabase.from('invoices').select('total').eq('status', 'paid').gte('issue_date', startOfMonth.toISOString().split('T')[0]),
      supabase.from('invoices').select('total, issue_date').eq('status', 'paid').gte('issue_date', startOfLastMonth.toISOString().split('T')[0]).lte('issue_date', endOfLastMonth.toISOString().split('T')[0]),
      supabase.from('route_sessions').select('id, worker_id, status').eq('status', 'in_progress').eq('date', today),
      supabase.from('recurring_invoice_templates').select('*, recurring_invoice_line_items(*)').eq('is_active', true)
    ])

    const allJobs = jobsToday || []
    const completedJobs = allJobs.filter(j => j.status === 'completed').length
    const pendingJobs = allJobs.filter(j => j.status === 'pending').length
    const inProgressJobs = allJobs.filter(j => j.status === 'travelling' || j.status === 'on_site').length

    const outstandingTotal = outstanding?.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) || 0
    const overdueTotal = overdue?.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) || 0

    const revenue = revenueThisMonth?.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) || 0
    const lastMonthRevenue = revenueLastMonth?.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) || 0
    const revenueChange = lastMonthRevenue > 0 ? ((revenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(0) : 0

    const { data: allWorkers } = await supabase.from('workers').select('id')
    const workerCount = allWorkers?.length || 0

    // Calculate recurring revenue (normalized to monthly)
    const recurringRevenue = recurringTemplates?.reduce((sum, template) => {
      const templateTotal = template.recurring_invoice_line_items?.reduce(
        (t, item) => t + (item.quantity * item.unit_price),
        0
      ) || 0
      
      let monthlyMultiplier
      switch (template.frequency) {
        case 'weekly': monthlyMultiplier = 4.33; break
        case 'fortnightly': monthlyMultiplier = 2.17; break
        case 'monthly': monthlyMultiplier = 1; break
        case 'quarterly': monthlyMultiplier = 0.33; break
        case 'annually': monthlyMultiplier = 0.083; break
        default: monthlyMultiplier = 1
      }
      return sum + (templateTotal * monthlyMultiplier)
    }, 0) || 0

    // Calculate upcoming this week
    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)
    const upcomingThisWeek = recurringTemplates?.filter(t => 
      t.next_run_date && new Date(t.next_run_date) <= nextWeek
    ).length || 0

    setKpis({
      jobsToday: allJobs.length,
      completedJobs,
      pendingJobs,
      inProgressJobs,
      routesToday: routesToday?.length || 0,
      routesCompleted: routesToday?.filter(r => r.status === 'completed').length || 0,
      routesInProgress: routesToday?.filter(r => r.status === 'in_progress').length || 0,
      routesNotStarted: routesToday?.filter(r => r.status === 'not_started').length || 0,
      outstanding: outstandingTotal,
      outstandingCount: outstanding?.length || 0,
      overdue: overdueTotal,
      overdueCount: overdue?.length || 0,
      revenue,
      revenueChange,
      activeWorkers: activeWorkersData?.length || 0,
      totalWorkers: workerCount,
      recurringRevenue,
      upcomingThisWeek
    })
  }

  async function loadTodayRoutes() {
    const today = new Date().toISOString().split('T')[0]
    
    const { data: sessions } = await supabase
      .from('route_sessions')
      .select('*, routes(name), workers(name)')
      .eq('date', today)
      .order('created_at')

    if (!sessions) return

    const routesWithProgress = await Promise.all(sessions.map(async (session) => {
      const { data: executions } = await supabase
        .from('job_executions')
        .select('status, arrived_at, started_at, completed_at, estimated_minutes, actual_minutes')
        .eq('route_session_id', session.id)
      
      const completed = executions?.filter(e => e.status === 'completed').length || 0
      const total = executions?.length || 0
      
      let elapsed = null
      if (session.status === 'in_progress' && session.started_at) {
        elapsed = Math.floor((new Date() - new Date(session.started_at)) / 1000 / 60)
      }
      
      return { 
        ...session, 
        completed, 
        total,
        elapsed
      }
    }))
    
    setTodayRoutes(routesWithProgress)
  }

  async function loadActiveWorkers() {
    const today = new Date().toISOString().split('T')[0]
    
    const { data: activeSessions } = await supabase
      .from('route_sessions')
      .select('*, routes(name), workers(name)')
      .eq('date', today)
      .eq('status', 'in_progress')

    if (!activeSessions) {
      setActiveWorkers([])
      return
    }

    const withProgress = await Promise.all(activeSessions.map(async (session) => {
      const { data: executions } = await supabase
        .from('job_executions')
        .select('status, customers(name)')
        .eq('route_session_id', session.id)
        .order('created_at')
      
      const completed = executions?.filter(e => e.status === 'completed').length || 0
      const total = executions?.length || 0
      const currentStop = executions?.find(e => e.status !== 'completed' && e.status !== 'skipped')
      
      let elapsed = null
      if (session.started_at) {
        elapsed = Math.floor((new Date() - new Date(session.started_at)) / 1000 / 60)
      }
      
      return { 
        ...session, 
        completed, 
        total,
        currentStop: currentStop?.customers?.name || 'Moving between stops',
        elapsed
      }
    }))
    
    setActiveWorkers(withProgress)
  }

  async function loadFinancials() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    
    const [{ data: revenue }, { data: expenses }, { data: vat }, { data: settings }] = await Promise.all([
      supabase.from('invoices').select('total, vat_amount').eq('status', 'paid').gte('issue_date', startOfMonth),
      supabase.from('expenses').select('amount, vat_amount').gte('expense_date', startOfMonth),
      supabase.from('invoices').select('vat_amount').eq('status', 'paid').gte('issue_date', startOfMonth),
      supabase.from('company_settings').select('vat_registration_number, vat_accounting_scheme').limit(1).single()
    ])

    const rev = revenue?.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) || 0
    const exp = expenses?.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0) || 0
    const vatCollected = vat?.reduce((s, i) => s + (parseFloat(i.vat_amount) || 0), 0) || 0

    setFinancials({ revenue: rev, expenses: exp, profit: rev - exp, vat: vatCollected })

    // Calculate next VAT return due
    const { data: nextObligation } = await supabase
      .from('vat_returns')
      .select('*')
      .eq('status', 'open')
      .order('due_date', { ascending: true })
      .limit(1)
      .single()

    if (nextObligation) {
      const dueDate = new Date(nextObligation.due_date)
      const today = new Date()
      const daysUntil = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24))
      
      setNextVatDue({
        dueDate: dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        amount: nextObligation.box_5 || 0,
        daysUntil,
        periodKey: nextObligation.period_key
      })
    } else if (settings?.vat_registration_number) {
      // Calculate next due date based on VAT period
      const vatPeriod = 'quarterly' // Could come from settings
      const quarter = Math.floor(now.getMonth() / 3)
      let nextQuarterEnd
      
      if (vatPeriod === 'quarterly') {
        const quarterEndMonths = [2, 5, 8, 11]
        nextQuarterEnd = new Date(now.getFullYear(), quarterEndMonths[quarter], 1)
        if (nextQuarterEnd < now) {
          nextQuarterEnd = new Date(now.getFullYear() + 1, quarterEndMonths[0], 1)
        }
      } else {
        nextQuarterEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      }
      
      nextQuarterEnd.setDate(nextQuarterEnd.getDate() + 7) // Due 7 days after quarter end
      
      const daysUntil = Math.ceil((nextQuarterEnd - now) / (1000 * 60 * 60 * 24))
      
      setNextVatDue({
        dueDate: nextQuarterEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        amount: vatCollected - (expenses?.reduce((s, i) => s + (parseFloat(i.vat_amount) || 0), 0) || 0),
        daysUntil,
        periodKey: 'To be calculated'
      })
    }
  }

  async function loadInvoiceBreakdown() {
    const { data: invoices } = await supabase.from('invoices').select('status')
    const breakdown = [
      { name: 'Draft', value: invoices?.filter(i => i.status === 'draft').length || 0, color: COLORS.draft },
      { name: 'Sent', value: invoices?.filter(i => i.status === 'sent').length || 0, color: COLORS.sent },
      { name: 'Paid', value: invoices?.filter(i => i.status === 'paid').length || 0, color: COLORS.paid },
      { name: 'Overdue', value: invoices?.filter(i => i.status === 'overdue').length || 0, color: COLORS.overdue }
    ]
    setInvoiceBreakdown(breakdown)
  }

  async function loadOutstandingInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*, customers(name)')
      .in('status', ['sent', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(5)
    setOutstandingInvoices(data || [])
  }

  async function loadActivity() {
    const { data } = await supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setActivity(data || [])
  }

  const formatMoney = (amount) => `£${(amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`

  const formatTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const formatElapsed = (minutes) => {
    if (!minutes) return '0m'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const getRouteStatusBadge = (status) => {
    const styles = {
      not_started: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-indigo-100 text-indigo-700',
      completed: 'bg-green-100 text-green-700'
    }
    const labels = {
      not_started: 'Not Started',
      in_progress: 'In Progress',
      completed: 'Completed'
    }
    return (
      <span className={`text-xs px-2 py-1 rounded ${styles[status] || styles.not_started}`}>
        {labels[status] || status}
      </span>
    )
  }

  const getEventIcon = (type, isOverdue = false) => {
    if (type?.includes('route_') || type?.includes('job_')) return '🗺️'
    if (type?.includes('invoice')) return '📄'
    if (type?.includes('payment') || type?.includes('gocardless_collection')) return '💰'
    if (type?.includes('mandate') || type?.includes('gocardless')) return '🔗'
    if (type?.includes('customer')) return '👤'
    if (isOverdue) return '⚠️'
    return '📌'
  }

  if (isWorker) {
    return <WorkerDashboard user={user} kpis={kpis} routes={todayRoutes} nextJob={activeWorkers[0]} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-500 text-sm">Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              Updated {formatTimeAgo(lastUpdated)}
            </span>
          )}
          <button 
            onClick={loadDashboard} 
            disabled={refreshing}
            className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50"
          >
            {refreshing ? '⟳' : '⟳'} Refresh
          </button>
        </div>
      </div>

      {/* Getting Started Checklist - Admin only */}
      {isAdmin && (
        <GettingStartedChecklist user={user} />
      )}

      {/* KPI Cards - 6 cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard 
          title="Jobs Today" 
          value={kpis.jobsToday} 
          color={COLORS.sent}
          subtitle={`${kpis.completedJobs || 0} done, ${kpis.pendingJobs || 0} pending`}
          loading={loading}
        />
        <KPICard 
          title="Routes Today" 
          value={kpis.routesToday} 
          color={COLORS.inProgress}
          subtitle={`${kpis.routesCompleted || 0} done, ${kpis.routesInProgress || 0} active`}
          loading={loading}
          onClick={() => navigate('/routes')}
        />
        <KPICard 
          title="Outstanding" 
          value={formatMoney(kpis.outstanding)} 
          color={COLORS.pending}
          subtitle={`${kpis.outstandingCount || 0} invoices`}
          loading={loading}
        />
        <KPICard 
          title="Overdue" 
          value={formatMoney(kpis.overdue)} 
          color={kpis.overdue > 0 ? COLORS.overdue : COLORS.pending}
          isHighlight={kpis.overdue > 0}
          subtitle={`${kpis.overdueCount || 0} invoices`}
          loading={loading}
        />
        <KPICard 
          title="Revenue" 
          value={formatMoney(kpis.revenue)} 
          color={COLORS.paid}
          subtitle={`${kpis.revenueChange || 0}% vs last month`}
          showArrow
          loading={loading}
        />
        <KPICard 
          title="Active Workers" 
          value={kpis.activeWorkers} 
          color={COLORS.inProgress}
          subtitle={`${kpis.activeWorkers || 0} of ${kpis.totalWorkers || 0} workers`}
          loading={loading}
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Routes (Left Panel) */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-lg">Today's Routes</h2>
            <Link to="/routes" className="text-blue-600 text-sm hover:underline">View All</Link>
          </div>
          
          {todayRoutes.length === 0 ? (
            <EmptyState 
              icon="🗺️"
              title="No routes scheduled for today"
              action={<Link to="/routes" className="text-blue-600 hover:underline">Create a route</Link>}
            />
          ) : (
            <div className="space-y-3">
              {todayRoutes.map(route => {
                const progress = route.total > 0 ? (route.completed / route.total) * 100 : 0
                const isOverdue = route.status === 'not_started' && route.scheduled_start_time && new Date() > new Date(route.scheduled_start_time)
                
                return (
                  <Link 
                    key={route.id} 
                    to={`/routes/${route.id}`}
                    className="block p-4 border rounded-lg hover:bg-gray-50 transition"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h3 className="font-medium">{route.routes?.name || 'Unnamed Route'}</h3>
                        <p className="text-sm text-gray-500">{route.workers?.name || 'Unassigned'}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {getRouteStatusBadge(route.status)}
                        {route.status === 'in_progress' && route.elapsed !== null && (
                          <span className="text-xs text-indigo-600 font-medium">
                            {formatElapsed(route.elapsed)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-indigo-600 h-2 rounded-full transition-all" 
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {route.completed}/{route.total} jobs
                      </span>
                    </div>
                    {isOverdue && (
                      <div className="mt-2 flex items-center gap-1 text-amber-600 text-sm">
                        <span>⚠️</span>
                        <span>Scheduled start time has passed</span>
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          )}

          {/* Active Workers Card */}
          {activeWorkers.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h3 className="font-medium text-sm text-gray-500 mb-3">Currently Active Workers</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeWorkers.map(worker => {
                  const progress = worker.total > 0 ? (worker.completed / worker.total) * 100 : 0
                  return (
                    <Link
                      key={worker.id}
                      to={`/routes/${worker.route_id}/execute`}
                      className="p-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-sm">{worker.workers?.name}</p>
                          <p className="text-xs text-gray-500">{worker.routes?.name}</p>
                        </div>
                        <span className="text-xs text-indigo-600 font-medium">
                          {formatElapsed(worker.elapsed)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-indigo-200 rounded-full h-1.5">
                          <div 
                            className="bg-indigo-600 h-1.5 rounded-full" 
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-indigo-600">
                          {worker.completed}/{worker.total}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Financial Snapshot (Right Panel) */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-lg mb-4">Financial Snapshot</h2>
          
          <div className="space-y-3 mb-6">
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-600">Revenue</span>
              <span className="font-medium text-green-600">{formatMoney(financials.revenue)}</span>
            </div>
            {isAdmin && (
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Expenses</span>
                <span className="font-medium text-red-600">{formatMoney(financials.expenses)}</span>
              </div>
            )}
            <div className="flex justify-between py-2 border-b">
              <span className="font-medium">Profit</span>
              <span className={`font-bold ${financials.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatMoney(financials.profit)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-600">VAT Collected</span>
              <span className="font-medium">{formatMoney(financials.vat)}</span>
            </div>
          </div>

          {/* VAT Return Warning */}
          <div className="mt-4 pt-4 border-t">
            <Link to="/reports/vat" className="block">
              <div className="p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition">
                <p className="text-sm font-medium text-gray-600">Next VAT Return</p>
                {nextVatDue ? (
                  <div className={`mt-1 ${nextVatDue.daysUntil <= 0 ? 'text-red-600' : nextVatDue.daysUntil <= 30 ? 'text-amber-600' : 'text-green-600'}`}>
                    <span className="font-bold">{formatMoney(nextVatDue.amount)}</span>
                    <span className="text-sm ml-2">
                      {nextVatDue.daysUntil <= 0 
                        ? 'OVERDUE' 
                        : `Due ${nextVatDue.dueDate}`}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">No VAT return due</p>
                )}
              </div>
            </Link>
          </div>

          {/* Recurring Revenue */}
          <div className="mt-4 pt-4 border-t">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Recurring Revenue</h3>
            <div className="flex justify-between py-1">
              <span className="text-gray-600">Monthly MRR</span>
              <span className="font-medium text-indigo-600">{formatMoney(kpis.recurringRevenue)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-600">Due This Week</span>
              <span className="font-medium">{kpis.upcomingThisWeek || 0} invoices</span>
            </div>
          </div>

          {/* Donut Chart */}
          <div className="h-48 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={invoiceBreakdown.filter(d => d.value > 0)} 
                  dataKey="value" 
                  nameKey="name" 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {invoiceBreakdown.filter(d => d.value > 0).map((entry, index) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Outstanding Invoices */}
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium">Outstanding Invoices</h3>
              <Link to="/invoices" className="text-xs text-blue-600 hover:underline">View All</Link>
            </div>
            {outstandingInvoices.length === 0 ? (
              <div className="text-center py-4 text-green-600">
                <span className="text-2xl">✓</span>
                <p className="text-sm">All invoices paid!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {outstandingInvoices.map(inv => {
                  const dueDate = new Date(inv.due_date)
                  const today = new Date()
                  const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24))
                  const isOverdue = daysOverdue > 0
                  
                  return (
                    <Link 
                      key={inv.id} 
                      to={`/invoices/${inv.id}`}
                      className={`flex justify-between text-sm p-2 rounded ${isOverdue ? 'bg-red-50' : ''}`}
                    >
                      <span className="truncate">{inv.customers?.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={isOverdue ? 'text-red-600' : 'text-gray-600'}>
                          {isOverdue ? `${daysOverdue}d overdue` : formatMoney(inv.total)}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          {!xeroConnected && !qboConnected && isAdmin && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700 mb-2">
                💡 Connect your accounting software to sync invoices automatically
              </p>
              <Link to="/settings?tab=xero" className="text-xs text-blue-600 hover:underline mr-3">
                Connect Xero
              </Link>
              <Link to="/settings?tab=quickbooks" className="text-xs text-blue-600 hover:underline">
                Connect QuickBooks
              </Link>
            </div>
          )}
          <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-2">
            <Link to="/invoices/new" className="px-3 py-2 text-center text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Create Invoice
            </Link>
            <Link to="/routes/new" className="px-3 py-2 text-center text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Create Route
            </Link>
            <Link to="/customers/new" className="px-3 py-2 text-center text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
              Add Customer
            </Link>
            {isAdmin && (
              <button className="px-3 py-2 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                Send Reminders
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-lg mb-4">Recent Activity</h2>
        
        {activity.length === 0 ? (
          <EmptyState 
            icon="📋"
            title="No activity yet"
            message="Activity will appear here as your team gets to work."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {activity.slice(0, 20).map(item => {
              const isOverdue = item.event_type?.includes('overdue') || item.event_type?.includes('failed')
              
              return (
                <Link
                  key={item.id}
                  to={
                    item.entity_type === 'invoice' ? `/invoices/${item.entity_id}` :
                    item.entity_type === 'route' ? `/routes/${item.entity_id}` :
                    item.entity_type === 'customer' ? `/customers/${item.entity_id}` :
                    '#'
                  }
                  className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 ${isOverdue ? 'bg-red-50' : ''}`}
                >
                  <span className="text-xl">{getEventIcon(item.event_type, isOverdue)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm line-clamp-2">{item.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{formatTimeAgo(item.created_at)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function KPICard({ title, value, color, subtitle, loading, onClick, isHighlight, showArrow }) {
  const Card = onClick ? Link : 'div'
  const content = (
    <div className={`bg-white p-4 rounded-xl border ${isHighlight ? 'ring-2 ring-red-500' : ''} ${onClick ? 'hover:border-blue-300 cursor-pointer' : ''}`}>
      <p className="text-sm text-gray-500">{title}</p>
      {loading ? (
        <div className="h-8 bg-gray-200 animate-pulse rounded mt-1" />
      ) : (
        <>
          <div className="flex items-baseline gap-1">
            <p className="text-2xl font-bold" style={{ color }}>
              {value}
            </p>
            {showArrow && subtitle?.includes('-') && <span>↓</span>}
            {showArrow && !subtitle?.includes('-') && !subtitle?.includes('0%') && <span>↑</span>}
          </div>
          {subtitle && (
            <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
          )}
        </>
      )}
    </div>
  )
  
  if (onClick) {
    return <Card to={onClick}>{content}</Card>
  }
  return content
}

function EmptyState({ icon, title, message, action }) {
  return (
    <div className="text-center py-8">
      <span className="text-4xl block mb-2">{icon}</span>
      <p className="text-gray-500">{title}</p>
      {message && <p className="text-sm text-gray-400 mt-1">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

function WorkerDashboard({ user, kpis, routes, nextJob }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Dashboard</h1>
        <p className="text-gray-500">Welcome back, {user?.name}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border">
          <p className="text-sm text-gray-500">Completed Today</p>
          <p className="text-3xl font-bold text-green-600">{kpis.completedToday || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border">
          <p className="text-sm text-gray-500">Routes Assigned</p>
          <p className="text-3xl font-bold text-blue-600">{kpis.routesAssigned || 0}</p>
        </div>
      </div>

      {nextJob && (
        <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
          <p className="text-sm text-indigo-600 font-medium">Next Job</p>
          <p className="text-lg font-semibold mt-1">{nextJob.customers?.name}</p>
        </div>
      )}

      <Link 
        to="/my-routes" 
        className="block w-full py-4 bg-blue-600 text-white text-center rounded-xl font-bold hover:bg-blue-700"
      >
        Go To My Routes
      </Link>

      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-semibold mb-3">Today's Routes</h2>
        {routes.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No routes assigned for today.</p>
        ) : (
          <div className="space-y-2">
            {routes.map(route => (
              <Link 
                key={route.id} 
                to={`/my-routes/${route.id}/execute`}
                className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium">{route.routes?.name}</p>
                  <p className="text-sm text-gray-500">{route.workers?.name}</p>
                </div>
                <span className="text-blue-600">Start →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}