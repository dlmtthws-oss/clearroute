import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import GlobalSearch from './GlobalSearch'
import NotificationPanel, { useNotificationCount } from './NotificationPanel'
import InstallPrompt from './InstallPrompt'
import AIAssistant from './AIAssistant.js'
import { supabase } from '../lib/supabase'

const adminLinks = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/customers', label: 'Customers', icon: '👥', subItems: [
    { to: '/customers/health', label: 'Customer Health', adminOnly: true }
  ] },
  { to: '/quotes', label: 'Quotes', icon: '💼' },
  { to: '/jobs', label: 'Jobs', icon: '🧹' },
  { to: '/routes', label: 'Routes', icon: '🗺️' },
  { to: '/scheduling', label: 'Smart Scheduling', icon: '✨', adminOnly: true },
  { to: '/invoices', label: 'Invoices', icon: '📄' },
  { to: '/accounting/bank-feed', label: 'Bank Feed', icon: '🏦' },
  { to: '/expenses', label: 'Expenses', icon: '💰' },
  { to: '/communications', label: 'Communications', icon: '📧', adminOnly: true },
  { to: '/reports', label: 'Reports', icon: '📈', subItems: [
    { to: '/reports', label: 'Overview' },
    { to: '/reports/vat', label: 'VAT Return', adminOnly: true },
    { to: '/reports/cash-flow', label: 'Cash Flow', adminOnly: true },
    { to: '/reports/insights', label: 'Insights', adminOnly: true },
    { to: '/reports/anomalies', label: 'Anomalies', adminOnly: true }
  ]},
  { to: '/settings', label: 'Settings', icon: '⚙️', subItems: [
    { to: '/settings', label: 'General' },
    { to: '/settings/audit-log', label: 'Audit Log', adminOnly: true }
  ]},
];

const workerLinks = [
  { to: '/my-routes', label: 'My Routes', icon: '🗺️' },
  { to: '/jobs', label: 'Jobs', icon: '🧹' }
]

export default function Layout({ user, children, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()
  
  const isWorker = user?.role === 'worker'
  const canSearch = !isWorker // Only admin/manager can use global search
  const links = isWorker ? workerLinks : adminLinks

  // Keyboard shortcut (Ctrl+K or Cmd+K)
  useEffect(() => {
    if (!canSearch) return
    
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canSearch])

  const [notificationOpen, setNotificationOpen] = useState(false)
  const notificationCount = useNotificationCount(user)
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
  
  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'admin': return 'bg-purple-100 text-purple-800'
      case 'manager': return 'bg-blue-100 text-blue-800'
      case 'worker': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const handleLogout = () => {
    onLogout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside 
        className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-gray-900 text-white transition-all duration-300 flex flex-col`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-700">
          {sidebarOpen && (
            <span className="font-bold text-lg tracking-tight">ClearRoute</span>
          )}
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded hover:bg-gray-700"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1 px-2">
            {links.map(({ to, label, icon, subItems }) => {
              if (subItems) {
                return (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                          isActive 
                            ? 'bg-gray-700 text-white' 
                            : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                        }`
                      }
                    >
                      <span className="text-lg">{icon}</span>
                      {sidebarOpen && <span>{label}</span>}
                    </NavLink>
                    {sidebarOpen && subItems.map(sub => (
                      sub.adminOnly && user?.role !== 'admin' ? null : (
                        <NavLink
                          key={sub.to}
                          to={sub.to}
                          className={({ isActive }) =>
                            `flex items-center gap-3 pl-10 pr-3 py-2 rounded-lg text-sm transition-colors ${
                              isActive 
                                ? 'bg-gray-600 text-white' 
                                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                            }`
                          }
                        >
                          {sub.label}
                        </NavLink>
                      )
                    ))}
                  </li>
                )
              }
              return (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        isActive 
                          ? 'bg-gray-700 text-white' 
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`
                    }
                  >
                    <span className="text-lg">{icon}</span>
                    {sidebarOpen && <span>{label}</span>}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User section at bottom */}
        <div className="p-4 border-t border-gray-700">
          {sidebarOpen ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{user?.name || user?.full_name || 'User'}</p>
                <span className={`text-xs px-2 py-0.5 rounded ${getRoleBadgeColor(user?.role)}`}>
                  {user?.role || 'User'}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="text-gray-400 hover:text-white text-sm"
                title="Logout"
              >
                🚪
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogout}
              className="w-full text-center text-gray-400 hover:text-white"
              title="Logout"
            >
              🚪
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Top header */}
        <header className="h-14 bg-white border-b flex items-center justify-between px-6 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-gray-800">
              {user?.role === 'worker' ? 'My Jobs' : 'Dashboard'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Accounting Connections */}
            {(xeroConnected || qboConnected) && (
              <div className="flex items-center gap-1">
                {xeroConnected && (
                  <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full" title="Connected to Xero">
                    Xero
                  </span>
                )}
                {qboConnected && (
                  <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full" title="Connected to QuickBooks">
                    QBO
                  </span>
                )}
              </div>
            )}
            {/* Notifications Bell */}
            <button
              onClick={() => setNotificationOpen(true)}
              className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {notificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs flex items-center justify-center rounded-full">
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </button>

            {canSearch && (
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-xs bg-white rounded border">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
                </kbd>
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{user?.name || user?.email}</span>
              <span className={`text-xs px-2 py-1 rounded ${getRoleBadgeColor(user?.role)}`}>
                {user?.role || 'User'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Logout
            </button>
          </div>
        </header>

        <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} user={user} />
        <NotificationPanel isOpen={notificationOpen} onClose={() => setNotificationOpen(false)} user={user} />
        <InstallPrompt />
        {user?.role !== 'worker' && <AIAssistant user={user} />}

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
