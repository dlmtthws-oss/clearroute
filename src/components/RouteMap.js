import { useState, useEffect } from 'react'
import { GoogleMap, useJsApiLoader, Marker, Polyline, InfoWindow } from '@react-google-maps/api'
import { supabase } from '../lib/supabase'

const mapContainerStyle = {
  width: '100%',
  height: '100%'
}

const defaultCenter = { lat: 53.4808, lng: -2.2426 }

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true
}

const libraries = ['places', 'geometry']

export default function RouteMap({ route, onClose, onOptimize, canEdit = true }) {
  const [stops, setStops] = useState([])
  const [selectedStop, setSelectedStop] = useState(null)
  const [driveTimes, setDriveTimes] = useState([])
  const [totalDistance, setTotalDistance] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const [loadingTimes, setLoadingTimes] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [geocoding, setGeocoding] = useState(false)

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries
  })

  useEffect(() => {
    if (route?.stops) {
      setStops(route.stops)
      geocodeStops(route.stops)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  useEffect(() => {
    if (stops.length > 0 && stops.some(s => s.lat && s.lng)) {
      calculateDriveTimes()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops])

  const geocodeAddress = async (address) => {
    if (!address || !apiKey) return null
    
    const addressStr = `${address.address_line_1}, ${address.city || ''}, ${address.postcode}, UK`
    const hash = btoa(addressStr.toLowerCase()).slice(0, 50)
    
    const { data: cached } = await supabase
      .from('geocode_cache')
      .select('*')
      .eq('address_hash', hash)
      .single()
    
    if (cached) {
      return { lat: cached.lat, lng: cached.lng }
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressStr)}&key=${apiKey}`
      )
      const data = await response.json()
      
      if (data.results?.[0]?.geometry?.location) {
        const { lat, lng } = data.results[0].geometry.location
        
        await supabase.from('geocode_cache').insert([{
          address_hash: hash,
          address_text: addressStr,
          lat,
          lng
        }])
        
        return { lat, lng }
      }
    } catch (err) {
      console.error('Geocoding error:', err)
    }
    return null
  }

  const geocodeStops = async (stopsToGeocode) => {
    if (!apiKey) return
    
    const stopsNeedingGeocode = stopsToGeocode.filter(s => !s.lat || !s.lng)
    if (stopsNeedingGeocode.length === 0) return

    setGeocoding(true)
    
    for (const stop of stopsNeedingGeocode) {
      const coords = await geocodeAddress(stop.customers)
      if (coords) {
        await supabase
          .from('route_stops')
          .update({ lat: coords.lat, lng: coords.lng })
          .eq('id', stop.id)
      }
    }

    const { data: updated } = await supabase
      .from('route_stops')
      .select('*, customers(name, address_line_1, city, postcode)')
      .eq('route_id', route.id)
      .order('stop_order')
    
    if (updated) {
      setStops(updated)
    }
    
    setGeocoding(false)
  }

  const calculateDriveTimes = async () => {
    if (!apiKey || stops.length < 2) return

    const stopsWithCoords = stops.filter(s => s.lat && s.lng)
    if (stopsWithCoords.length < 2) return

    setLoadingTimes(true)

    try {
      const origin = `${stopsWithCoords[0].lat},${stopsWithCoords[0].lng}`
      const destination = `${stopsWithCoords[stopsWithCoords.length - 1].lat},${stopsWithCoords[stopsWithCoords.length - 1].lng}`
      const waypoints = stopsWithCoords.slice(1, -1).map(s => `${s.lat},${s.lng}`).join('|')

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ''}&key=${apiKey}`
      )
      const data = await response.json()

      if (data.routes?.[0]?.legs) {
        const legs = data.routes[0].legs
        const times = legs.map(leg => ({
          from: leg.start_address,
          to: leg.end_address,
          duration: leg.duration.value,
          distance: leg.distance.value
        }))
        setDriveTimes(times)

        const total = legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0)
        const time = legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0)
        setTotalDistance(total)
        setTotalTime(time)
      }
    } catch (err) {
      console.error('Error calculating drive times:', err)
    }

    setLoadingTimes(false)
  }

  const handleOptimize = async () => {
    if (!apiKey || stops.length < 2) return

    const stopsWithCoords = stops.filter(s => s.lat && s.lng)
    if (stopsWithCoords.length < 2) {
      alert('Need more stops with geocoded addresses to optimize')
      return
    }

    setLoadingTimes(true)

    try {
      const origins = stopsWithCoords.map(s => `${s.lat},${s.lng}`)
      
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins.join('|')}&destinations=${origins.join('|')}&key=${apiKey}`
      )
      const data = await response.json()

      if (data.rows) {
        const distanceMatrix = data.rows.map(row => row.elements.map(el => el.distance?.value || Infinity))

        const ordered = nearestNeighborOptimization(distanceMatrix, stopsWithCoords)
        
        if (onOptimize) {
          onOptimize(ordered)
        }
      }
    } catch (err) {
      console.error('Error optimizing route:', err)
    }

    setLoadingTimes(false)
  }

  const nearestNeighborOptimization = (matrix, stopsWithCoords) => {
    const n = matrix.length
    const visited = new Set()
    const ordered = [0]
    visited.add(0)

    while (ordered.length < n) {
      const current = ordered[ordered.length - 1]
      let nearest = -1
      let minDist = Infinity

      for (let i = 0; i < n; i++) {
        if (!visited.has(i) && matrix[current][i] < minDist) {
          minDist = matrix[current][i]
          nearest = i
        }
      }

      if (nearest !== -1) {
        ordered.push(nearest)
        visited.add(nearest)
      }
    }

    return ordered.map(i => stopsWithCoords[i])
  }

  const formatDuration = (seconds) => {
    const mins = Math.round(seconds / 60)
    if (mins < 60) return `${mins} min`
    const hrs = Math.floor(mins / 60)
    const remainingMins = mins % 60
    return `${hrs}h ${remainingMins}m`
  }

  const formatDistance = (meters) => {
    const km = meters / 1000
    return `${km.toFixed(1)} km`
  }

  const getMapCenter = () => {
    const stopsWithCoords = stops.filter(s => s.lat && s.lng)
    if (stopsWithCoords.length > 0) {
      return {
        lat: stopsWithCoords[0].lat,
        lng: stopsWithCoords[0].lng
      }
    }
    return defaultCenter
  }

  const getPolylinePath = () => {
    return stops.filter(s => s.lat && s.lng).map(s => ({ lat: s.lat, lng: s.lng }))
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100">
        <div className="text-center p-8">
          <p className="text-red-600 mb-2">Error loading Google Maps</p>
          <p className="text-gray-500">{loadError.message}</p>
        </div>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading map...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} bg-white border-r overflow-hidden transition-all duration-300 flex flex-col`}>
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Stops ({stops.length})</h2>
          <button onClick={() => setSidebarOpen(false)} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {geocoding && (
          <div className="p-3 bg-yellow-50 text-yellow-700 text-sm">
            Geocoding addresses...
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {stops.map((stop, index) => (
            <div 
              key={stop.id}
              className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${selectedStop?.id === stop.id ? 'bg-blue-50' : ''}`}
              onClick={() => setSelectedStop(stop)}
            >
              <div className="flex items-start gap-2">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{stop.customers?.name}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {stop.customers?.address_line_1}, {stop.customers?.postcode}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {stop.estimated_duration || 30} min
                    {stop.lat && stop.lng && ' • 📍'}
                  </p>
                </div>
              </div>
              {driveTimes[index] && (
                <p className="text-xs text-gray-500 mt-1 ml-8">
                  → {formatDuration(driveTimes[index].duration)}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Route Summary */}
        <div className="p-4 border-t bg-gray-50">
          {loadingTimes ? (
            <p className="text-sm text-gray-500 text-center">Calculating...</p>
          ) : (
            <>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Total Distance:</span>
                <span className="font-medium">{totalDistance > 0 ? formatDistance(totalDistance) : '-'}</span>
              </div>
              <div className="flex justify-between text-sm mb-3">
                <span className="text-gray-600">Est. Time:</span>
                <span className="font-medium">{totalTime > 0 ? formatDuration(totalTime) : '-'}</span>
              </div>
              {canEdit && (
                <button
                  onClick={handleOptimize}
                  disabled={loadingTimes || stops.length < 2}
                  className="w-full px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm"
                >
                  Optimize Route
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 z-10 px-3 py-2 bg-white rounded-lg shadow hover:bg-gray-50"
          >
            ☰ Stops
          </button>
        )}

        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={getMapCenter()}
          zoom={13}
          options={mapOptions}
        >
          {/* Markers */}
          {stops.filter(s => s.lat && s.lng).map((stop, index) => (
            <Marker
              key={stop.id}
              position={{ lat: stop.lat, lng: stop.lng }}
              label={{
                text: String(index + 1),
                color: 'white',
                fontSize: '12px',
                fontWeight: 'bold'
              }}
              onClick={() => setSelectedStop(stop)}
            />
          ))}

          {/* Polyline */}
          {getPolylinePath().length > 1 && (
            <Polyline
              path={getPolylinePath()}
              options={{
                strokeColor: '#2563eb',
                strokeOpacity: 0.8,
                strokeWeight: 4
              }}
            />
          )}

          {/* Info Window */}
          {selectedStop && (
            <InfoWindow
              position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
              onCloseClick={() => setSelectedStop(null)}
            >
              <div className="p-2 max-w-xs">
                <p className="font-semibold">{selectedStop.customers?.name}</p>
                <p className="text-sm text-gray-600">
                  {selectedStop.customers?.address_line_1}, {selectedStop.customers?.postcode}
                </p>
                <p className="text-sm mt-1">
                  <strong>Duration:</strong> {selectedStop.estimated_duration || 30} min
                </p>
                <p className="text-sm">
                  <strong>Stop #{selectedStop.stop_order}</strong>
                </p>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 px-3 py-2 bg-white rounded-lg shadow hover:bg-gray-50"
        >
          Close Map
        </button>
      )}
    </div>
  )
}
