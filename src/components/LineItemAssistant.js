import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const TYPICAL_SERVICES = [
  'Window Cleaning — External',
  'Window Cleaning — Internal and External',
  'Gutter Cleaning',
  'Conservatory Roof Cleaning',
  'Solar Panel Cleaning',
  'Frame and Sill Cleaning'
]

export default function LineItemAssistant({ customerId, onApplyItem, value }) {
  const [suggestions, setSuggestions] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [priceSuggestion, setPriceSuggestion] = useState(null)
  const [query, setQuery] = useState(value || '')
  const wrapperRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (query.length > 1) {
      const filtered = TYPICAL_SERVICES.filter(s =>
        s.toLowerCase().includes(query.toLowerCase())
      )
      setSuggestions(filtered.slice(0, 5))
    } else {
      setSuggestions(TYPICAL_SERVICES.slice(0, 5))
    }
  }, [query])

  const fetchPriceSuggestion = async (serviceType) => {
    if (!customerId || !serviceType) return

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
            action: 'suggest-price',
            customer_id: customerId,
            service_type: serviceType
          })
        }
      )

      if (response.ok) {
        const result = await response.json()
        setPriceSuggestion(result.suggestion)
      }
    } catch (err) {
      console.error('Failed to fetch price:', err)
    }
    setLoading(false)
  }

  const handleSelect = (item) => {
    setQuery(item)
    setShowDropdown(false)
    fetchPriceSuggestion(item)
  }

  const handleApply = () => {
    if (!query) return

    const price = priceSuggestion?.average_unit_price || 50
    const item = {
      description: query,
      quantity: 1,
      unit_price: price,
      vat_rate: 0.20
    }

    if (onApplyItem) {
      onApplyItem(item)
    }

    setQuery('')
    setPriceSuggestion(null)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShowDropdown(true)
              setPriceSuggestion(null)
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Enter description or search..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
          />
          
          {showDropdown && suggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {priceSuggestion && (
        <div className="mt-2 p-2 bg-blue-50 rounded-md">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-blue-600 font-medium">Suggested Price</div>
              <div className="text-sm">
                £{priceSuggestion.average_unit_price.toFixed(2)}
                {priceSuggestion.sample_count > 0 && (
                  <span className="text-xs text-gray-500 ml-1">
                    (avg of {priceSuggestion.sample_count} invoices)
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
          {priceSuggestion.sample_count > 0 && (
            <div className="text-xs text-gray-500 mt-1">
              Range: £{priceSuggestion.min_unit_price.toFixed(2)} - £{priceSuggestion.max_unit_price.toFixed(2)}
            </div>
          )}
        </div>
      )}

      {!priceSuggestion && query && !loading && (
        <button
          type="button"
          onClick={fetchPriceSuggestion}
          disabled={loading}
          className="mt-2 text-xs text-blue-600 hover:text-blue-700"
        >
          Get pricing suggestion
        </button>
      )}

      {loading && (
        <div className="mt-2 text-xs text-gray-500">Loading pricing data...</div>
      )}
    </div>
  )
}