import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AIQuickStart({ customerId, onSelectItems, onCancel }) {
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState('')
  const [suggestions, setSuggestions] = useState(null)

  useEffect(() => {
    fetchRoutes()
  }, [])

  const fetchRoutes = async () => {
    const { data } = await supabase
      .from('routes')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
      .limit(20)
    
    if (data) setRoutes(data)
  }

  const loadFromRoute = async () => {
    if (!selectedRoute) return
    setLoading(true)

    try {
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invoice-writing-assistant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            action: 'suggest-line-items',
            customer_id: customerId,
            route_id: selectedRoute
          })
        }
      )

      if (response.ok) {
        const result = await response.json()
        setSuggestions(result)
      }
    } catch (err) {
      console.error('Failed to load suggestions:', err)
    }

    setLoading(false)
  }

  const loadFromHistory = async () => {
    if (!customerId) return
    setLoading(true)

    try {
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invoice-writing-assistant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            action: 'suggest-line-items',
            customer_id: customerId
          })
        }
      )

      if (response.ok) {
        const result = await response.json()
        setSuggestions(result)
      }
    } catch (err) {
      console.error('Failed to load suggestions:', err)
    }

    setLoading(false)
  }

  const handleApply = () => {
    if (suggestions?.line_items && onSelectItems) {
      onSelectItems(suggestions.line_items)
    }
  }

  if (suggestions) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-3">
          AI Suggested Line Items
        </h3>
        
        <div className="space-y-2 mb-4">
          {suggestions.line_items?.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 bg-gray-50 rounded"
            >
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  {item.description}
                </div>
                <div className="text-xs text-gray-500">
                  {item.reasoning}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">
                  £{item.unit_price.toFixed(2)}
                </div>
                <div className="text-xs text-gray-500">
                  x{item.quantity}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 px-3 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800"
          >
            Apply Suggestions
          </button>
          <button
            type="button"
            onClick={() => setSuggestions(null)}
            className="px-3 py-2 text-gray-700 text-sm hover:bg-gray-100 rounded-md"
          >
            Regenerate
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-medium text-gray-900 mb-3">
        Quick Start Options
      </h3>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Create from Route
          </label>
          <select
            value={selectedRoute}
            onChange={(e) => setSelectedRoute(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
          >
            <option value="">Select route...</option>
            {routes.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadFromRoute}
            disabled={!selectedRoute || loading}
            className="mt-2 w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load Route Data'}
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-white text-gray-500">or</span>
          </div>
        </div>

        <button
          type="button"
          onClick={loadFromHistory}
          disabled={!customerId || loading}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'AI Suggestions from History'}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="w-full px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}