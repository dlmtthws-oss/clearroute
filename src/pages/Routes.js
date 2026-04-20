import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import RouteMap from '../components/RouteMap'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'
import { SkeletonTable, SkeletonMap } from '../components/SkeletonComponents'
import { EmptyStateRoutes } from '../components/EmptyStates'

export default function Routes({ user }) {
  const [routes, setRoutes] = useState([])
  const [workers, setWorkers] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [newRoute, setNewRoute] = useState({ 
    name: '', 
    scheduled_date: '',
    assigned_to: '',
    status: 'draft'
  })
  const [saving, setSaving] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [filteredCustomers, setFilteredCustomers] = useState([])
  const [showMap, setShowMap] = useState(false)
  const [optimizeSuggestion, setOptimizeSuggestion] = useState(null)
  
  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const isWorker = user?.role === 'worker'

  useEffect(() => {
    fetchRoutes()
    fetchWorkers()
    fetchCustomers()
  }, [])

  const fetchRoutes = async () => {
    setLoading(true)
    let query = supabase
      .from('routes')
      .select('*, profiles(full_name), route_stops(*)')
      .order('created_at', { ascending: false })
    
    if (isWorker && user?.id) {
      query = supabase
        .from('routes')
        .select('*, profiles(full_name), route_stops(*)')
        .eq('assigned_to', user.id)
        .order('created_at', { ascending: false })
    }
    
    const { data, error } = await query
    
    if (!error && data) {
      const routesWithStops = await Promise.all((data || []).map(async (route) => {
        const { data: stops } = await supabase
          .from('route_stops')
          .select('*, customers(name, address_line_1, city, postcode)')
          .eq('route_id', route.id)
          .order('stop_order')
        return { ...route, stops: stops || [] }
      }))
      setRoutes(routesWithStops)
    }
    setLoading(false)
  }

  const fetchWorkers = async () => {
    const { data } = await supabase
      .from('workers')
      .select('id, name, email, role')
      .eq('is_active', true)
      .order('name')
    setWorkers(data || [])
  }

  const fetchCustomers = async () => {
    const { data } = await supabase
      .from('customers')
      .select('id, name, address_line_1, city, postcode')
      .order('name')
    setCustomers(data || [])
  }

  const handleSave = async () => {
    if (!newRoute.name) return
    setSaving(true)
    
    const routeData = {
      name: newRoute.name,
      scheduled_date: newRoute.scheduled_date || null,
      assigned_to: newRoute.assigned_to || null,
      status: newRoute.status || 'draft'
    }
    
    const { data, error } = await supabase
      .from('routes')
      .insert([routeData])
      .select()
    
    if (!error) {
      logAuditEvent(
        AUDIT_ACTIONS.ROUTE_CREATED,
        'route',
        data?.[0]?.id,
        routeData.name,
        null,
        routeData
      )
      
      setNewRoute({ name: '', scheduled_date: '', assigned_to: '', status: 'draft' })
      setShowForm(false)
      fetchRoutes()
    }
    setSaving(false)
  }

  const handleUpdateRoute = async () => {
    if (!selectedRoute) return
    setSaving(true)
    
    const { error } = await supabase
      .from('routes')
      .update({
        name: selectedRoute.name,
        scheduled_date: selectedRoute.scheduled_date || null,
        assigned_to: selectedRoute.assigned_to || null,
        status: selectedRoute.status || 'draft'
      })
      .eq('id', selectedRoute.id)
    
    if (!error) {
      logAuditEvent(
        AUDIT_ACTIONS.ROUTE_UPDATED,
        'route',
        selectedRoute.id,
        selectedRoute.name,
        null,
        selectedRoute
      )
      fetchRoutes()
    }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this route and all its stops?')) return
    const route = routes.find(r => r.id === id)
    await supabase.from('routes').delete().eq('id', id)
    fetchRoutes()
    
    logAuditEvent(
      AUDIT_ACTIONS.ROUTE_DELETED,
      'route',
      id,
      route?.name,
      route,
      null
    )
  }

  const handleAddStop = async (customerId) => {
    if (!selectedRoute) return
    
    const currentStops = selectedRoute.stops || []
    const nextOrder = currentStops.length + 1
    
    await supabase.from('route_stops').insert([{
      route_id: selectedRoute.id,
      customer_id: customerId,
      stop_order: nextOrder,
      estimated_duration: 30
    }])
    
    const { data: stops } = await supabase
      .from('route_stops')
      .select('*, customers(name, address_line_1, city, postcode)')
      .eq('route_id', selectedRoute.id)
      .order('stop_order')
    
    setSelectedRoute({ ...selectedRoute, stops: stops || [] })
    fetchRoutes()
  }

  const handleRemoveStop = async (stopId) => {
    await supabase.from('route_stops').delete().eq('id', stopId)
    
    const { data: refreshedStops } = await supabase
      .from('route_stops')
      .select('*, customers(name, address_line_1, city, postcode)')
      .eq('route_id', selectedRoute.id)
      .order('stop_order')
    
    setSelectedRoute({ ...selectedRoute, stops: refreshedStops || [] })
    fetchRoutes()
  }

  const handleUpdateStop = async (stopId, updates) => {
    await supabase
      .from('route_stops')
      .update(updates)
      .eq('id', stopId)
    
    const { data: refreshedStops } = await supabase
      .from('route_stops')
      .select('*, customers(name, address_line_1, city, postcode)')
      .eq('route_id', selectedRoute.id)
      .order('stop_order')
    
    setSelectedRoute({ ...selectedRoute, stops: refreshedStops || [] })
    fetchRoutes()
  }

  const handleMoveStop = async (stop, direction) => {
    const currentStops = [...(selectedRoute.stops || [])]
    const index = currentStops.findIndex(s => s.id === stop.id)
    
    if (direction === 'up' && index > 0) {
      const newOrder = currentStops[index - 1].stop_order
      const currentOrder = stop.stop_order
      await handleUpdateStop(stop.id, { stop_order: -1 })
      await handleUpdateStop(currentStops[index - 1].id, { stop_order: currentOrder })
      await handleUpdateStop(stop.id, { stop_order: newOrder })
    } else if (direction === 'down' && index < currentStops.length - 1) {
      const newOrder = currentStops[index + 1].stop_order
      const currentOrder = stop.stop_order
      await handleUpdateStop(stop.id, { stop_order: -1 })
      await handleUpdateStop(currentStops[index + 1].id, { stop_order: currentOrder })
      await handleUpdateStop(stop.id, { stop_order: newOrder })
    }
    
    const { data: updatedStops } = await supabase
      .from('route_stops')
      .select('*, customers(name, address_line_1, city, postcode)')
      .eq('route_id', selectedRoute.id)
      .order('stop_order')
    
    setSelectedRoute({ ...selectedRoute, stops: updatedStops || [] })
    fetchRoutes()
  }

  const handleSearchChange = (e) => {
    const search = e.target.value
    setCustomerSearch(search)
    if (search.length > 0) {
      const filtered = customers.filter(c => 
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.postcode?.toLowerCase().includes(search.toLowerCase()) ||
        c.address_line_1?.toLowerCase().includes(search.toLowerCase())
      )
      setFilteredCustomers(filtered)
    } else {
      setFilteredCustomers([])
    }
  }

  const handleCloseRoute = () => {
    setSelectedRoute(null)
    setCustomerSearch('')
    setFilteredCustomers([])
  }

  const handleOptimize = async (optimizedStops) => {
    setOptimizeSuggestion(optimizedStops)
  }

  const applyOptimization = async () => {
    if (!optimizeSuggestion || !selectedRoute) return
    
    for (let i = 0; i < optimizeSuggestion.length; i++) {
      await supabase
        .from('route_stops')
        .update({ stop_order: i + 1 })
        .eq('id', optimizeSuggestion[i].id)
    }
    
    setOptimizeSuggestion(null)
    fetchRoutes()
    
    const { data: stops } = await supabase
      .from('route_stops')
      .select('*, customers(name, address_line_1, city, postcode)')
      .eq('route_id', selectedRoute.id)
      .order('stop_order')
    
    setSelectedRoute({ ...selectedRoute, stops: stops || [] })
  }

  const dismissOptimization = () => {
    setOptimizeSuggestion(null)
  }

  const getStatusBadge = (status) => {
    switch(status) {
      case 'active': return 'bg-green-100 text-green-800'
      case 'completed': return 'bg-blue-100 text-blue-800'
      case 'draft': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const filteredRoutes = statusFilter === 'all' 
    ? routes 
    : routes.filter(r => r.status === statusFilter)

  if (loading) {
    return <div className="p-6"><SkeletonTable rows={8} /></div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Routes</h1>
          <p className="text-gray-600 text-sm">
            {isWorker ? 'Your assigned routes' : 'Manage cleaning routes'}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Create Route'}
          </button>
        )}
      </div>

      {/* Status Filter */}
      <div className="flex gap-2 mb-6">
        {['all', 'draft', 'active', 'completed'].map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              statusFilter === status 
                ? 'bg-gray-900 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Create Route Form */}
      {showForm && canEdit && (
        <div className="bg-white p-6 rounded-lg border mb-6">
          <h3 className="font-medium mb-4">Create New Route</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Route Name *</label>
              <input
                type="text"
                value={newRoute.name}
                onChange={(e) => setNewRoute({...newRoute, name: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g. Monday Round"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scheduled Date</label>
              <input
                type="date"
                value={newRoute.scheduled_date}
                onChange={(e) => setNewRoute({...newRoute, scheduled_date: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Assign To</label>
              <select
                value={newRoute.assigned_to}
                onChange={(e) => setNewRoute({...newRoute, assigned_to: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">Unassigned</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={newRoute.status}
                onChange={(e) => setNewRoute({...newRoute, status: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !newRoute.name}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Route'}
          </button>
        </div>
      )}

      {/* Routes List */}
      {filteredRoutes.length === 0 ? (
        <EmptyStateRoutes isWorker={isWorker} />
      ) : (
        <div className="grid gap-4">
          {filteredRoutes.map(route => (
            <div key={route.id} className="bg-white p-4 rounded-lg border hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start">
                <div 
                  className="flex-1 cursor-pointer"
                  onClick={() => setSelectedRoute(route)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-lg">{route.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadge(route.status)}`}>
                      {route.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {route.scheduled_date || 'No date set'} • {(route.route_stops || []).length} stops
                    {route.profiles?.full_name && ` • ${route.profiles.full_name}`}
                  </p>
                  {(route.stops || route.route_stops || []).length > 0 && (
                    <p className="text-sm text-gray-400 mt-1">
                      {route.stops?.slice(0, 3).map(s => s.customers?.name).join(', ')}
                      {(route.stops?.length || route.route_stops?.length || 0) > 3 && ` +${(route.stops?.length || route.route_stops?.length || 0) - 3} more`}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedRoute(route)
                      setShowMap(true)
                    }}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    View Map
                  </button>
                  {canEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(route.id)
                      }}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Route Detail Modal */}
      {selectedRoute && !showMap && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Edit Route</h2>
                <button onClick={handleCloseRoute} className="text-gray-500 hover:text-gray-700">
                  ✕ Close
                </button>
              </div>

              {/* Route Details Form */}
              {canEdit && (
                <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                  <div>
                    <label className="block text-sm font-medium mb-1">Route Name</label>
                    <input
                      type="text"
                      value={selectedRoute.name || ''}
                      onChange={(e) => setSelectedRoute({...selectedRoute, name: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Scheduled Date</label>
                    <input
                      type="date"
                      value={selectedRoute.scheduled_date || ''}
                      onChange={(e) => setSelectedRoute({...selectedRoute, scheduled_date: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Assign To</label>
                    <select
                      value={selectedRoute.assigned_to || ''}
                      onChange={(e) => setSelectedRoute({...selectedRoute, assigned_to: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">Unassigned</option>
                      {workers.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    <select
                      value={selectedRoute.status || 'draft'}
                      onChange={(e) => setSelectedRoute({...selectedRoute, status: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <button
                      onClick={handleUpdateRoute}
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Update Route Details'}
                    </button>
                  </div>
                </div>
              )}

              {/* Add Stop */}
              {canEdit && (
                <div className="mb-6">
                  <h3 className="font-medium mb-2">Add Customer to Route</h3>
                  <input
                    type="text"
                    placeholder="Search customers by name or address..."
                    value={customerSearch}
                    onChange={handleSearchChange}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                  {filteredCustomers.length > 0 && (
                    <div className="mt-2 border rounded-lg max-h-48 overflow-y-auto">
                      {filteredCustomers.slice(0, 8).map(customer => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            handleAddStop(customer.id)
                            setCustomerSearch('')
                            setFilteredCustomers([])
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                        >
                          <span className="font-medium">{customer.name}</span>
                          <span className="text-gray-500 text-sm ml-2">
                            {customer.address_line_1}, {customer.postcode}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Current Stops */}
              <div>
                <h3 className="font-medium mb-2">
                  Stops ({selectedRoute.stops?.length || 0})
                </h3>
                {(selectedRoute.stops || []).length === 0 ? (
                  <p className="text-gray-500 py-4">No customers added yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedRoute.stops.map((stop, index) => (
                      <div key={stop.id} className="flex items-start gap-2 bg-gray-50 p-3 rounded-lg">
                        {canEdit && (
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => handleMoveStop(stop, 'up')}
                              disabled={index === 0}
                              className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => handleMoveStop(stop, 'down')}
                              disabled={index === selectedRoute.stops.length - 1}
                              className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            >
                              ▼
                            </button>
                          </div>
                        )}
                        <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">
                          {index + 1}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium">{stop.customers?.name}</p>
                          <p className="text-sm text-gray-500">
                            {stop.customers?.address_line_1}, {stop.customers?.postcode}
                          </p>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={stop.estimated_duration || 30}
                              onChange={(e) => handleUpdateStop(stop.id, { estimated_duration: parseInt(e.target.value) || 30 })}
                              className="w-16 px-2 py-1 border rounded text-sm"
                              min="1"
                            />
                            <span className="text-xs text-gray-500">min</span>
                          </div>
                        )}
                        {canEdit && (
                          <input
                            type="text"
                            value={stop.notes || ''}
                            onChange={(e) => handleUpdateStop(stop.id, { notes: e.target.value })}
                            placeholder="Notes..."
                            className="w-24 px-2 py-1 border rounded text-sm"
                          />
                        )}
                        {canEdit && (
                          <button
                            onClick={() => handleRemoveStop(stop.id)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Map Modal */}
      {showMap && selectedRoute && (
        <div className="fixed inset-0 bg-white z-50">
          <RouteMap 
            route={selectedRoute}
            canEdit={canEdit}
            onClose={() => setShowMap(false)}
            onOptimize={handleOptimize}
          />
        </div>
      )}

      {/* Optimize Suggestion Modal */}
      {optimizeSuggestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-bold mb-4">Optimize Route?</h3>
            <p className="text-gray-600 mb-4">
              Reorder stops for the most efficient route based on distance?
            </p>
            <div className="flex gap-2">
              <button
                onClick={applyOptimization}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Apply
              </button>
              <button
                onClick={dismissOptimization}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}