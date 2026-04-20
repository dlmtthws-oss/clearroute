import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const RECENT_SEARCHES_KEY = 'clearroute_recent_searches'
const MAX_RECENT = 5

const QUICK_ACTIONS = [
  { id: 'create-invoice', label: 'Create Invoice', path: '/invoices', icon: '📄' },
  { id: 'create-route', label: 'Create Route', path: '/routes', icon: '🗺️' },
  { id: 'add-customer', label: 'Add Customer', path: '/customers', icon: '👤' },
  { id: 'import-customers', label: 'Import Customers', path: '/customers/import', icon: '📥' },
]

export default function GlobalSearch({ isOpen, onClose, user }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ customers: [], invoices: [], routes: [] })
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentSearches, setRecentSearches] = useState([])
  
  const debounceRef = useRef(null)

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
      if (stored) {
        setRecentSearches(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load recent searches')
    }
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
    if (!isOpen) {
      setQuery('')
      setResults({ customers: [], invoices: [], routes: [] })
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      setResults({ customers: [], invoices: [], routes: [] })
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.rpc('global_search', {
          query_text: query.trim(),
          limit_per_table: 5
        })

        if (!error && data) {
          const customers = data.filter(r => r.result_type === 'customer')
          const invoices = data.filter(r => r.result_type === 'invoice')
          const routes = data.filter(r => r.result_type === 'route')
          setResults({ customers, invoices, routes })
        }
      } catch (err) {
        console.error('Search error:', err)
      }
      setLoading(false)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query])

  // Save to recent searches
  const saveRecentSearch = (item) => {
    const newRecent = [
      { type: item.result_type, id: item.id, title: item.title },
      ...recentSearches.filter(r => r.id !== item.id)
    ].slice(0, MAX_RECENT)
    
    setRecentSearches(newRecent)
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newRecent))
    } catch (e) {}
  }

  const clearRecentSearches = () => {
    setRecentSearches([])
    localStorage.removeItem(RECENT_SEARCHES_KEY)
  }

  // Flatten results for keyboard navigation
  const getFlatResults = () => {
    if (query.trim()) {
      return [
        ...results.customers.map(r => ({ ...r, section: 'customer' })),
        ...results.invoices.map(r => ({ ...r, section: 'invoice' })),
        ...results.routes.map(r => ({ ...r, section: 'route' })),
      ]
    }
    return []
  }

  const navigateTo = (type, id) => {
    switch (type) {
      case 'customer':
        navigate(`/customers`)
        break
      case 'invoice':
        navigate(`/invoices`)
        break
      case 'route':
        navigate(`/routes/${id}`)
        break
      default:
        break
    }
    onClose()
  }

  const handleKeyDown = useCallback((e) => {
    const flatResults = getFlatResults()
    const totalItems = flatResults.length + (query.trim() ? 0 : QUICK_ACTIONS.length + recentSearches.length)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      
      if (!query.trim()) {
        // Quick action or recent search
        if (selectedIndex < recentSearches.length) {
          const recent = recentSearches[selectedIndex]
          navigateTo(recent.type, recent.id)
        } else if (selectedIndex < recentSearches.length + QUICK_ACTIONS.length) {
          const action = QUICK_ACTIONS[selectedIndex - recentSearches.length]
          navigate(action.path)
          onClose()
        }
      } else if (flatResults[selectedIndex]) {
        const item = flatResults[selectedIndex]
        saveRecentSearch(item)
        navigateTo(item.section, item.id)
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  // These functions are intentionally defined inline for performance and simplicity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedIndex, recentSearches, navigate, onClose])

  const handleResultClick = (item) => {
    saveRecentSearch(item)
    navigateTo(item.result_type, item.id)
  }

  const flatResults = getFlatResults()
  const hasResults = flatResults.length > 0
  const isEmpty = !query.trim() && !hasResults

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 animate-fade-in" />
      
      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden animate-scale-in">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b">
          <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search customers, invoices, routes..."
            className="flex-1 text-lg outline-none placeholder-gray-400"
          />
          <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-xs text-gray-400 bg-gray-100 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
            </div>
          )}

          {!loading && isEmpty && (
            <div className="py-4">
              {/* Recent Searches */}
              {recentSearches.length > 0 && (
                <div className="px-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium text-gray-500 uppercase">Recent</h3>
                    <button onClick={clearRecentSearches} className="text-xs text-gray-400 hover:text-gray-600">
                      Clear
                    </button>
                  </div>
                  {recentSearches.map((recent, idx) => (
                    <button
                      key={recent.id}
                      onClick={() => navigateTo(recent.type, recent.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                        selectedIndex === idx ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-lg">
                        {recent.type === 'customer' ? '👤' : recent.type === 'invoice' ? '📄' : '🗺️'}
                      </span>
                      <span className="flex-1">{recent.title}</span>
                      <span className="text-xs text-gray-400 capitalize">{recent.type}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Quick Actions */}
              <div className="px-4 mt-4">
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Quick Actions</h3>
                {QUICK_ACTIONS.map((action, idx) => (
                  <button
                    key={action.id}
                    onClick={() => { navigate(action.path); onClose() }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                      selectedIndex === recentSearches.length + idx ? 'bg-gray-100' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg">{action.icon}</span>
                    <span className="flex-1">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && query.trim() && !hasResults && (
            <div className="py-8 text-center text-gray-500">
              No results found for "{query}"
            </div>
          )}

          {!loading && hasResults && (
            <div className="py-2">
              {/* Customers */}
              {results.customers.length > 0 && (
                <div className="px-4 mb-2">
                  <h3 className="text-xs font-medium text-gray-500 uppercase mb-1">Customers</h3>
                  {results.customers.map((item, idx) => (
                    <button
                      key={item.id}
                      onClick={() => handleResultClick(item)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                        selectedIndex === idx ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-lg">👤</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.title}</div>
                        <div className="text-sm text-gray-500 truncate">{item.subtitle}</div>
                      </div>
                      {item.metadata?.service_type && (
                        <span className="text-xs text-gray-400">{item.metadata.service_type}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Invoices */}
              {results.invoices.length > 0 && (
                <div className="px-4 mb-2">
                  <h3 className="text-xs font-medium text-gray-500 uppercase mb-1">Invoices</h3>
                  {results.invoices.map((item, idx) => {
                    const offset = results.customers.length
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleResultClick(item)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                          selectedIndex === offset + idx ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-lg">📄</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          <div className="text-sm text-gray-500 truncate">{item.subtitle}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">£{item.metadata?.total?.toFixed(2)}</div>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            item.metadata?.status === 'paid' ? 'bg-green-100 text-green-700' :
                            item.metadata?.status === 'overdue' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {item.metadata?.status}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Routes */}
              {results.routes.length > 0 && (
                <div className="px-4">
                  <h3 className="text-xs font-medium text-gray-500 uppercase mb-1">Routes</h3>
                  {results.routes.map((item, idx) => {
                    const offset = results.customers.length + results.invoices.length
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleResultClick(item)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                          selectedIndex === offset + idx ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-lg">🗺️</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          <div className="text-sm text-gray-500 truncate">{item.subtitle}</div>
                        </div>
                        <div className="text-right">
                          {item.metadata?.scheduled_date && (
                            <div className="text-xs text-gray-500">{item.metadata.scheduled_date}</div>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            item.metadata?.status === 'active' ? 'bg-green-100 text-green-700' :
                            item.metadata?.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {item.metadata?.status}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-gray-50 border-t flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white rounded border">↑↓</kbd> Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white rounded border">↵</kbd> Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white rounded border">ESC</kbd> Close
          </span>
        </div>
      </div>
    </div>
  )
}