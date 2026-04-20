import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const OPTIMISATION_TYPES = [
  { 
    id: 'geographic', 
    label: 'Quick Optimise', 
    description: 'Simple geographic ordering - fastest calculation',
    icon: '📍'
  },
  { 
    id: 'ai_enhanced', 
    label: 'AI Optimise', 
    description: 'Uses historical performance data (recommended)',
    icon: '🤖'
  },
  { 
    id: 'predictive', 
    label: 'Predictive Optimise', 
    description: 'Accounts for today\'s conditions and traffic',
    icon: '🔮'
  }
]

export default function RouteBuilder({ routeId, routeName, stops, onSave, onCancel }) {
  const [localStops, setLocalStops] = useState(stops || [])
  const [optimising, setOptimising] = useState(false)
  const [optimisationResult, setOptimisationResult] = useState(null)
  const [selectedType, setSelectedType] = useState('ai_enhanced')
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState({})
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    if (stops?.length > 0) {
      loadCustomers()
    }
  }, [stops])

  const loadCustomers = async () => {
    const customerIds = stops.map(s => s.customer_id)
    const { data } = await supabase
      .from('customers')
      .select('id, name, address, postcode, lat, lng')
      .in('id', customerIds)
    
    if (data) {
      const map = {}
      data.forEach(c => { map[c.id] = c })
      setCustomers(map)
    }
  }

  const handleOptimise = async () => {
    if (!routeId) {
      const { data: newRoute, error } = await supabase
        .from('routes')
        .insert({ name: routeName || 'New Route', stops: localStops })
        .select()
        .single()
      
      if (error || !newRoute) {
        console.error('Failed to create route:', error)
        return
      }
    }

    setOptimising(true)
    setLoading(true)

    try {
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-optimise-route`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            route_id: routeId,
            optimisation_type: selectedType
          })
        }
      )

      const result = await response.json()
      
      if (result.error) {
        console.error('Optimisation error:', result.error)
        return
      }

      setOptimisationResult(result)
      setShowCompare(true)
    } catch (error) {
      console.error('Optimisation failed:', error)
    } finally {
      setLoading(false)
      setOptimising(false)
    }
  }

  const handleApplySuggestion = () => {
    if (!optimisationResult?.suggested_order) return
    
    const newStops = optimisationResult.suggested_order.map(id => {
      const existing = localStops.find(s => s.id === id || s.customer_id === id)
      return existing || { id, customer_id: id }
    })

    setLocalStops(newStops)
    setShowCompare(false)
    setOptimisationResult(null)
  }

  const handleAcceptSuggestion = async () => {
    if (!optimisationResult?.run_id) return

    setLoading(true)
    try {
      await supabase.rpc('accept_route_optimisation', { p_run_id: optimisationResult.run_id })
      
      if (onSave) {
        const { data: updatedRoute } = await supabase
          .from('routes')
          .select('*')
          .eq('id', routeId)
          .single()
        
        onSave(updatedRoute)
      }
    } catch (error) {
      console.error('Accept failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRejectSuggestion = async () => {
    if (!optimisationResult?.run_id) return
    
    setLoading(true)
    try {
      await supabase.rpc('reject_route_optimisation', { 
        p_run_id: optimisationResult.run_id,
        p_reason: 'Manually rejected by user'
      })
      
      setShowCompare(false)
      setOptimisationResult(null)
    } catch (error) {
      console.error('Reject failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const moveStop = (index, direction) => {
    const newStops = [...localStops]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    
    if (newIndex < 0 || newIndex >= newStops.length) return
    
    const temp = newStops[index]
    newStops[index] = newStops[newIndex]
    newStops[newIndex] = temp
    
    setLocalStops(newStops)
  }

  const removeStop = (index) => {
    setLocalStops(localStops.filter((_, i) => i !== index))
  }

  const getStopName = (customerId) => {
    return customers[customerId]?.name || customerId
  }

  const getPostcode = (customerId) => {
    return customers[customerId]?.postcode || ''
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <input
            type="text"
            value={routeName || ''}
            onChange={(e) => onSave?.({ name: e.target.value })}
            placeholder="Route Name"
            className="text-2xl font-bold border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 outline-none px-1"
          />
        </div>
        <div className="flex gap-2">
          {!routeId && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => onSave?.(localStops)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save Route
          </button>
        </div>
      </div>

      {/* Optimise Button */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900">Optimise This Route</h3>
            <p className="text-sm text-gray-500">Use AI to find a more efficient stop order</p>
          </div>
          <button
            onClick={() => setOptimising(true)}
            disabled={loading || localStops.length < 2}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 font-medium"
          >
            {loading ? 'Optimising...' : 'Optimise Route'}
          </button>
        </div>

        {/* Optimisation Type Selection */}
        {optimising && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            {OPTIMISATION_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  selectedType === type.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-2">{type.icon}</div>
                <div className="font-medium">{type.label}</div>
                <div className="text-sm text-gray-500">{type.description}</div>
              </button>
            ))}
          </div>
        )}

        {optimising && (
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => {
                setOptimising(false)
                setSelectedType('ai_enhanced')
              }}
              className="px-4 py-2 text-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleOptimise}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Running...' : 'Run Optimisation'}
            </button>
          </div>
        )}
      </div>

      {/* Comparison Display */}
      {showCompare && optimisationResult && (
        <OptimisationComparison
          result={optimisationResult}
          onAccept={handleAcceptSuggestion}
          onReject={handleRejectSuggestion}
          onApplyManually={handleApplySuggestion}
          customers={customers}
          loading={loading}
        />
      )}

      {/* Stops List */}
      <div className="mt-6">
        <h4 className="font-medium text-gray-900 mb-4">
          Stops ({localStops.length})
        </h4>
        
        {localStops.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No stops added yet
          </div>
        ) : (
          <div className="space-y-2">
            {localStops.map((stop, index) => (
              <div
                key={stop.id || stop.customer_id}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <span className="w-8 h-8 flex items-center justify-center bg-gray-200 rounded-full text-sm font-medium">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {getStopName(stop.customer_id)}
                  </div>
                  <div className="text-sm text-gray-500 truncate">
                    {getPostcode(stop.customer_id)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => moveStop(index, 'up')}
                    disabled={index === 0}
                    className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveStop(index, 'down')}
                    disabled={index === localStops.length - 1}
                    className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeStop(index)}
                    className="p-2 text-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OptimisationComparison({ result, onAccept, onReject, onApplyManually, customers, loading }) {
  const getCustomerName = (id) => customers[id]?.name || id

  return (
    <div className="mt-6 border-2 border-blue-200 rounded-lg p-6 bg-blue-50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-blue-900">AI Optimisation Complete</h3>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm text-gray-600">Confidence Score</div>
            <div className="text-2xl font-bold text-blue-600">
              {Math.round((result.confidence || 0) * 100)}%
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Before */}
        <div>
          <h4 className="font-medium text-gray-700 mb-2">Current Order</h4>
          <div className="bg-white rounded p-3 text-sm max-h-40 overflow-y-auto">
            {result.original_order?.map((id, i) => (
              <div key={id} className="flex gap-2 py-1">
                <span className="text-gray-400 w-6">{i + 1}.</span>
                <span className="truncate">{getCustomerName(id)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-lg font-medium">
            Est: {result.original_minutes} mins
          </div>
        </div>

        {/* After */}
        <div>
          <h4 className="font-medium text-gray-700 mb-2">Suggested Order</h4>
          <div className="bg-white rounded p-3 text-sm max-h-40 overflow-y-auto">
            {result.suggested_order?.map((id, i) => (
              <div key={id} className="flex gap-2 py-1">
                <span className="text-blue-500 font-medium w-6">{i + 1}.</span>
                <span className="truncate">{getCustomerName(id)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-lg font-medium text-green-600">
            Est: {result.suggested_minutes} mins
          </div>
        </div>
      </div>

      {/* Improvement */}
      <div className="mb-4 p-4 bg-white rounded-lg flex items-center justify-between">
        <div>
          <div className="text-3xl font-bold text-green-600">
            -{result.improvement_minutes} minutes
          </div>
          <div className="text-sm text-gray-500">
            {result.improvement_percent}% faster
          </div>
        </div>
        <div className="text-sm text-gray-600 max-w-md">
          <strong>Why:</strong> {result.explanation}
        </div>
      </div>

      {/* Factors Used */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {result.factors && Object.entries(result.factors).map(([factor, used]) => (
          <span
            key={factor}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              used ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {factor.replace('_', ' ')}: {used ? '✓' : '✗'}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReject}
          disabled={loading}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Reject Suggestion
        </button>
        <button
          onClick={onApplyManually}
          disabled={loading}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
        >
          Apply Without Accepting
        </button>
        <button
          onClick={onAccept}
          disabled={loading}
          className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Saving...' : 'Accept & Apply'}
        </button>
      </div>
    </div>
  )
}