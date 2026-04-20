import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import RouteBuilder from './RouteBuilder'

export default function RouteList() {
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [customers, setCustomers] = useState({})

  useEffect(() => {
    fetchRoutes()
  }, [])

  const fetchRoutes = async () => {
    const { data, error } = await supabase
      .from('routes')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setRoutes(data)
      
      const allCustomerIds = new Set()
      data.forEach(r => {
        r.stops?.forEach(s => allCustomerIds.add(s.customer_id))
      })

      if (allCustomerIds.size > 0) {
        const { data: custData } = await supabase
          .from('customers')
          .select('id, name, address, postcode')
          .in('id', [...allCustomerIds])
        
        if (custData) {
          const map = {}
          custData.forEach(c => { map[c.id] = c })
          setCustomers(map)
        }
      }
    }
    setLoading(false)
  }

  const handleDelete = async (routeId) => {
    if (window.confirm && !window.confirm('Delete this route?')) return
    
    await supabase.from('routes').delete().eq('id', routeId)
    fetchRoutes()
  }

  const getStopNames = (stops) => {
    if (!stops || stops.length === 0) return 'No stops'
    const names = stops.slice(0, 3).map(s => customers[s.customer_id]?.name || s.customer_id)
    const remaining = stops.length - 3
    return names.join(', ') + (remaining > 0 ? ` +${remaining} more` : '')
  }

  const getTotalMinutes = (stops) => {
    return stops?.reduce((sum, s) => sum + (s.estimated_minutes || 30), 0) || 0
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading routes...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Routes</h2>
        <button
          onClick={() => setSelectedRoute({ name: '' })}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Create Route
        </button>
      </div>

      {routes.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow" role="status" aria-label="No routes">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Routes Yet</h3>
          <p className="text-gray-500 mb-4">
            Create your first route to start optimising your daily schedule
          </p>
          <button
            onClick={() => setSelectedRoute({ name: '' })}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Create Route
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {routes.map(route => (
            <div
              key={route.id}
              className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedRoute(route)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium truncate">
                      {route.name || 'Unnamed Route'}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                      {route.stops?.length || 0} stops
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 truncate">
                    {getStopNames(route.stops)}
                  </p>
                  <div className="flex gap-4 mt-2 text-sm text-gray-600">
                    <span>⏱️ {getTotalMinutes(route.stops)} mins</span>
                    <span>📍 {route.stops?.length || 0} stops</span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(route.id)
                  }}
                  className="p-2 text-gray-400 hover:text-red-600"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedRoute && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <RouteBuilder
              routeId={selectedRoute.id}
              routeName={selectedRoute.name}
              stops={selectedRoute.stops}
              onSave={(result) => {
                setSelectedRoute(null)
                fetchRoutes()
              }}
              onCancel={() => setSelectedRoute(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}