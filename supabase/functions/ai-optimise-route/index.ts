import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface StopData {
  id: string
  customer_id: string
  customer_name: string
  address: string
  lat: number
  lng: number
  postcode: string
  estimated_minutes: number
}

interface PerformanceData {
  customer_id: string
  day_of_week: number
  month: number
  hour_of_day: number
  avg_actual_minutes: number
  sample_count: number
}

interface Phase1Result {
  stops: StopData[]
  stopPerformance: PerformanceData[]
  routeHistory: {
    avg_actual_minutes: number
    sample_count: number
  } | null
  dayOfWeek: number
  month: number
  hourOfDay: number
}

interface DistanceMatrixResult {
  origin: string
  destination: string
  duration_minutes: number
  distance_km: number
}

interface ClaudeRequest {
  stops: StopData[]
  performance: PerformanceData[]
  routeHistory: Phase1Result['routeHistory']
  dayOfWeek: number
  month: number
  hourOfDay: number
  distances: DistanceMatrixResult[]
  optimisationType: string
}

interface ClaudeResponse {
  suggested_order: string[]
  reasoning: string
  confidence: number
  estimated_minutes: number
  factors: Record<string, boolean>
}

async function getGoogleDistanceMatrix(
  stops: StopData[],
  googleApiKey: string
): Promise<DistanceMatrixResult[]> {
  const results: DistanceMatrixResult[] = []

  const origins = stops.map(s => `${s.lat},${s.lng}`)
  const destinations = stops.map(s => `${s.lat},${s.lng}`)

  const batches: { origin: StopData; dest: StopData }[] = []
  for (const origin of stops) {
    for (const dest of stops) {
      if (origin.id !== dest.id) {
        batches.push({ origin, dest })
      }
    }
  }

  const batchSize = 10
  for (let i = 0; i < batches.length; i += batchSize) {
    const batch = batches.slice(i, i + batchSize)
    const originsStr = batch.map(b => b.origin.lat + ',' + b.origin.lng).join('|')
    const destinationsStr = batch.map(b => b.dest.lat + ',' + b.dest.lng).join('|')

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsStr}&destinations=${destinationsStr}&key=${googleApiKey}`

    try {
      const response = await fetch(url)
      const data = await response.json() as any

      if (data.status === 'OK' && data.rows) {
        for (let j = 0; j < batch.length; j++) {
          const element = data.rows[j]?.elements?.[j]
          if (element?.status === 'OK') {
            results.push({
              origin: batch[j].origin.id,
              destination: batch[j].dest.id,
              duration_minutes: Math.round(element.duration?.value / 60 || 0),
              distance_km: parseFloat((element.distance?.value / 1000 || 0).toFixed(1))
            })
          }
        }
      }
    } catch (error) {
      console.error('Distance matrix error:', error)
    }
  }

  return results
}

async function callClaude(
  request: ClaudeRequest,
  claudeApiKey: string
): Promise<ClaudeResponse> {
  const prompt = `You are a route optimisation expert for a window cleaning business. Analyse the route and suggest an optimal stop order that minimises total time.

## Current Route Data:
- ${request.stops.length} stops to visit
- Optimisation type: ${request.optimisationType}

## Stop Details:
${request.stops.map((s, i) => `${i + 1}. ${s.customer_name} (${s.id})
   Address: ${s.address}
   Postcode: ${s.postcode}
   Estimated minutes: ${s.estimated_minutes}`).join('\n')}

## Historical Performance Data (actual durations):
${request.performance.length === 0 ? 'No historical data available' :
request.performance.map(p => `- Customer ${p.customer_id}: avg ${p.avg_actual_minutes} mins (${p.sample_count} samples, day ${p.day_of_week}, month ${p.month}, hour ${p.hour_of_day})`).join('\n')}

## Route History:
${request.routeHistory ? `Average actual route duration: ${request.routeHistory.avg_actual_minutes} mins (${request.routeHistory.sample_count} completions)` : 'No route history available'}

## Current Context:
- Day of week: ${request.dayOfWeek} (0=Monday, 6=Sunday)
- Month: ${request.month}
- Hour of day: ${request.hourOfDay}

## Drive Times Between Stops (from Google Maps):
${request.distances.map(d => `- ${d.origin} → ${d.destination}: ${d.duration_minutes} mins (${d.distance_km} km)`).join('\n')}

## Requirements for Optimisation:
1. Consider drive time between stops from distance matrix
2. Account for historical actual job durations - some stops consistently take longer than estimated
3. Morning vs afternoon effects
4. Day of week effects (Mon-Fri vs weekends)
5. Seasonal effects (summer vs winter)
6. Avoid backtracking between areas
7. Group stops in same postcode districts

Respond with JSON only (no other text):
{
  "suggested_order": ["stop_id_1", "stop_id_2", ...],
  "reasoning": "explanation of key decisions",
  "confidence": 0.0-1.0,
  "estimated_minutes": total_estimated_minutes,
  "factors": {
    "drive_time": true/false,
    "historical_performance": true/false,
    "time_of_day": true/false,
    "day_of_week": true/false,
    "seasonal": true/false,
    "geographic_clustering": true/false
  }
}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 2000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await response.json() as any
  const content = data.content?.[0]?.text || ''
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.error('Claude parse error:', e)
  }

  return {
    suggested_order: request.stops.map(s => s.id),
    reasoning: 'Could not parse Claude response, returning original order',
    confidence: 0.5,
    estimated_minutes: request.stops.reduce((sum, s) => sum + s.estimated_minutes, 0),
    factors: {
      drive_time: false,
      historical_performance: false,
      time_of_day: false,
      day_of_week: false,
      seasonal: false,
      geographic_clustering: false
    }
  }
}

async function phase1CollectData(supabase: any, routeId: string): Promise<Phase1Result> {
  const { data: route, error: routeError } = await supabase
    .from('routes')
    .select('*')
    .eq('id', routeId)
    .single()

  if (routeError || !route) {
    throw new Error('Route not found')
  }

  const stopsOrder = route.stops || []
  if (stopsOrder.length === 0) {
    throw new Error('Route has no stops')
  }

  const customerIds = stopsOrder.map((s: any) => s.customer_id)

  const { data: customers, error: custError } = await supabase
    .from('customers')
    .select('id, name, address, lat, lng, postcode')
    .in('id', customerIds)

  if (custError) {
    throw new Error('Failed to fetch customers')
  }

  const customerMap = new Map(customers.map((c: any) => [c.id, c]))

  const stops: StopData[] = stopsOrder.map((s: any, index: number) => {
    const customer = customerMap.get(s.customer_id)
    return {
      id: s.id || s.customer_id,
      customer_id: s.customer_id,
      customer_name: customer?.name || 'Unknown',
      address: customer?.address || '',
      lat: customer?.lat || 0,
      lng: customer?.lng || 0,
      postcode: customer?.postcode || '',
      estimated_minutes: s.estimated_minutes || 30
    }
  }).filter((s: StopData) => s.lat && s.lng)

  const now = new Date()
  const dayOfWeek = now.getDay()
  const month = now.getMonth() + 1
  const hourOfDay = now.getHours()

  const { data: performance, error: perfError } = await supabase
    .from('stop_performance_history')
    .select('*')
    .in('customer_id', customerIds)

  let routeHistory = null
  const { data: routeRuns } = await supabase
    .from('route_optimisation_runs')
    .select('original_estimated_minutes, suggested_estimated_minutes')
    .eq('route_id', routeId)
    .eq('status', 'accepted')

  if (routeRuns && routeRuns.length > 0) {
    const totalOriginal = routeRuns.reduce((sum: number, r: any) => sum + (r.original_estimated_minutes || 0), 0)
    const totalSuggested = routeRuns.reduce((sum: number, r: any) => sum + (r.suggested_estimated_minutes || 0), 0)
    const avgOriginal = totalOriginal / routeRuns.length
    const avgSuggested = totalSuggested / routeRuns.length
    
    routeHistory = {
      avg_actual_minutes: avgSuggested,
      sample_count: routeRuns.length
    }
  }

  return {
    stops,
    stopPerformance: performance || [],
    routeHistory,
    dayOfWeek,
    month,
    hourOfDay
  }
}

async function phase2DistanceMatrix(stops: StopData[], googleApiKey: string): Promise<DistanceMatrixResult[]> {
  if (!googleApiKey || googleApiKey.length < 10) {
    return []
  }

  try {
    return await getGoogleDistanceMatrix(stops, googleApiKey)
  } catch (error) {
    console.error('Distance matrix error:', error)
    return []
  }
}

async function phase3ClaudeAnalysis(
  phase1Data: Phase1Result,
  distances: DistanceMatrixResult[],
  optimisationType: string,
  claudeApiKey: string
): Promise<ClaudeResponse> {
  if (!claudeApiKey || claudeApiKey.length < 10) {
    return {
      suggested_order: phase1Data.stops.map(s => s.id),
      reasoning: 'No Claude API key configured',
      confidence: 0.3,
      estimated_minutes: phase1Data.stops.reduce((sum, s) => sum + s.estimated_minutes, 0),
      factors: {
        drive_time: false,
        historical_performance: false,
        time_of_day: false,
        day_of_week: false,
        seasonal: false,
        geographic_clustering: false
      }
    }
  }

  const request: ClaudeRequest = {
    stops: phase1Data.stops,
    performance: phase1Data.stopPerformance,
    routeHistory: phase1Data.routeHistory,
    dayOfWeek: phase1Data.dayOfWeek,
    month: phase1Data.month,
    hourOfDay: phase1Data.hourOfDay,
    distances,
    optimisationType
  }

  return await callClaude(request, claudeApiKey)
}

async function phase4StoreResult(
  supabase: any,
  routeId: string,
  optimisationType: string,
  originalOrder: string[],
  suggestedOrder: string[],
  originalMinutes: number,
  suggestedMinutes: number,
  confidence: number,
  factors: Record<string, boolean>,
  explanation: string
) {
  const improvement = originalMinutes - suggestedMinutes
  const improvementPercent = originalMinutes > 0 
    ? parseFloat(((improvement / originalMinutes) * 100).toFixed(2))
    : 0

  const { data: run, error: insertError } = await supabase
    .from('route_optimisation_runs')
    .insert({
      route_id: routeId,
      optimisation_type: optimisationType,
      original_stop_order: originalOrder,
      suggested_stop_order: suggestedOrder,
      original_estimated_minutes: originalMinutes,
      suggested_estimated_minutes: suggestedMinutes,
      improvement_minutes: improvement,
      improvement_percent: improvementPercent,
      confidence_score: confidence,
      factors_used: factors,
      ai_explanation: explanation,
      status: 'pending'
    })
    .select()
    .single()

  if (insertError) {
    throw new Error('Failed to store optimisation result: ' + insertError.message)
  }

  return run
}

async function getRouteEstimateForOrder(
  supabase: any,
  stops: StopData[],
  order: string[],
  distances: DistanceMatrixResult[]
): Promise<number> {
  const stopMap = new Map(stops.map(s => [s.id, s]))
  const distanceMap = new Map(distances.map(d => [`${d.origin}-${d.destination}`, d]))

  let totalMinutes = 0
  const orderedStops = order.map(id => stopMap.get(id)).filter(Boolean)

  for (const stop of orderedStops) {
    totalMinutes += stop?.estimated_minutes || 30
  }

  for (let i = 0; i < order.length - 1; i++) {
    const key = `${order[i]}-${order[i + 1]}`
    const dist = distanceMap.get(key)
    if (dist) {
      totalMinutes += dist.duration_minutes
    }
  }

  return totalMinutes
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''

    const body = await req.json()
    const { route_id, optimisation_type = 'ai_enhanced' } = body

    if (!route_id) {
      return new Response(JSON.stringify({ error: 'route_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!['geographic', 'ai_enhanced', 'predictive'].includes(optimisation_type)) {
      return new Response(JSON.stringify({ error: 'Invalid optimisation_type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const phase1Data = await phase1CollectData(supabase, route_id)
    const originalOrder = phase1Data.stops.map(s => s.id)
    const originalMinutes = phase1Data.stops.reduce((sum, s) => sum + s.estimated_minutes, 0)

    let distances: DistanceMatrixResult[] = []
    if (optimisation_type !== 'geographic') {
      distances = await phase2DistanceMatrix(phase1Data.stops, googleApiKey)
    }

    const claudeResult = await phase3ClaudeAnalysis(
      phase1Data,
      distances,
      optimisation_type,
      claudeApiKey
    )

    const suggestedOrder = claudeResult.suggested_order.filter((id: string) => 
      originalOrder.includes(id)
    )

    const suggestedMinutes = await getRouteEstimateForOrder(
      supabase,
      phase1Data.stops,
      suggestedOrder,
      distances
    )

    const run = await phase4StoreResult(
      supabase,
      route_id,
      optimisation_type,
      originalOrder,
      suggestedOrder,
      originalMinutes,
      suggestedMinutes,
      claudeResult.confidence,
      claudeResult.factors,
      claudeResult.reasoning
    )

    return new Response(JSON.stringify({
      success: true,
      run_id: run.id,
      original_order: originalOrder,
      suggested_order: suggestedOrder,
      original_minutes: originalMinutes,
      suggested_minutes: suggestedMinutes,
      improvement_minutes: originalMinutes - suggestedMinutes,
      improvement_percent: originalMinutes > 0 
        ? parseFloat((((originalMinutes - suggestedMinutes) / originalMinutes) * 100).toFixed(2))
        : 0,
      confidence: claudeResult.confidence,
      factors: claudeResult.factors,
      explanation: claudeResult.reasoning,
      stops: phase1Data.stops
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Optimisation error:', error)
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}