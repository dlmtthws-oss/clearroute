import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JobExecution {
  id: string
  customer_id: string
  route_id: string
  scheduled_date: string
  completed_at: string
  estimated_minutes: number
  actual_minutes: number
}

interface PerformanceUpdate {
  customer_id: string
  day_of_week: number
  month: number
  hour_of_day: number
  actual_minutes: number
  sample_count: number
}

async function fetchJobExecutions(
  supabase: any,
  days: number = 30
): Promise<JobExecution[]> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  const { data, error } = await supabase
    .from('job_executions')
    .select('id, customer_id, route_id, scheduled_date, completed_at, estimated_minutes, actual_minutes')
    .gte('completed_at', cutoffDate.toISOString())
    .not('actual_minutes', 'is', null)
    .order('completed_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch job executions:', error)
    return []
  }

  return data || []
}

async function calculatePerformance(
  executions: JobExecution[]
): Promise<Map<string, PerformanceUpdate>> {
  const performanceMap = new Map<string, PerformanceUpdate>()

  for (const job of executions) {
    if (!job.completed_at || !job.actual_minutes) continue

    const completedDate = new Date(job.completed_at)
    const dayOfWeek = completedDate.getDay()
    const month = completedDate.getMonth() + 1
    const hour = completedDate.getHours()

    const key = `${job.customer_id}-${dayOfWeek}-${month}-${hour}`
    const existing = performanceMap.get(key)

    if (existing) {
      const totalMinutes = existing.actual_minutes * existing.sample_count
      const newCount = existing.sample_count + 1
      const avgMinutes = (totalMinutes + job.actual_minutes) / newCount

      performanceMap.set(key, {
        customer_id: job.customer_id,
        day_of_week: dayOfWeek,
        month,
        hour_of_day: hour,
        actual_minutes: avgMinutes,
        sample_count: newCount
      })
    } else {
      performanceMap.set(key, {
        customer_id: job.customer_id,
        day_of_week: dayOfWeek,
        month,
        hour_of_day: hour,
        actual_minutes: job.actual_minutes,
        sample_count: 1
      })
    }
  }

  return performanceMap
}

async function updateStopPerformanceHistory(
  supabase: any,
  performance: Map<string, PerformanceUpdate>
): Promise<{ updated: number; errors: number }> {
  let updated = 0
  let errors = 0

  for (const [, perf] of performance) {
    const { error } = await supabase
      .from('stop_performance_history')
      .upsert({
        customer_id: perf.customer_id,
        day_of_week: perf.day_of_week,
        month: perf.month,
        hour_of_day: perf.hour_of_day,
        avg_actual_minutes: perf.actual_minutes,
        sample_count: perf.sample_count,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'customer_id, day_of_week, month, hour_of_day'
      })

    if (error) {
      console.error('Update error:', error)
      errors++
    } else {
      updated++
    }
  }

  return { updated, errors }
}

async function calculateRouteLevelStats(
  supabase: any,
  executions: JobExecution[]
): Promise<void> {
  const routeMap = new Map<string, JobExecution[]>()

  for (const job of executions) {
    if (!job.route_id) continue
    
    const existing = routeMap.get(job.route_id) || []
    existing.push(job)
    routeMap.set(job.route_id, existing)
  }

  for (const [routeId, jobs] of routeMap) {
    if (jobs.length < 3) continue

    const avgActual = jobs.reduce((sum, j) => sum + (j.actual_minutes || 0), 0) / jobs.length
    const avgEstimated = jobs.reduce((sum, j) => sum + (j.estimated_minutes || 0), 0) / jobs.length

    console.log(`Route ${routeId}: avg actual ${avgActual.toFixed(1)} mins, avg estimated ${avgEstimated.toFixed(1)} mins`)
  }
}

async function identifySlowStops(
  executions: JobExecution[]
): Promise<{ customer_id: string; avg_over: number; sample_count: number }[]> {
  const customerMap = new Map<string, { total: number; count: number }>()

  for (const job of executions) {
    if (!job.actual_minutes || !job.estimated_minutes || !job.customer_id) continue

    const over = job.actual_minutes - job.estimated_minutes
    if (over <= 0) continue

    const existing = customerMap.get(job.customer_id) || { total: 0, count: 0 }
    existing.total += over
    existing.count += 1
    customerMap.set(job.customer_id, existing)
  }

  const results: { customer_id: string; avg_over: number; sample_count: number }[] = []
  
  for (const [customer_id, data] of customerMap) {
    if (data.count >= 3) {
      results.push({
        customer_id,
        avg_over: data.total / data.count,
        sample_count: data.count
      })
    }
  }

  return results.sort((a, b) => b.avg_over - a.avg_over).slice(0, 10)
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    const days = body.days || 30

    const executions = await fetchJobExecutions(supabase, days)
    
    if (executions.length === 0) {
      return new Response(JSON.stringify({
        message: 'No job executions found in the last ' + days + ' days',
        executions_processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const performance = await calculatePerformance(executions)
    const { updated, errors } = await updateStopPerformanceHistory(supabase, performance)
    
    await calculateRouteLevelStats(supabase, executions)
    
    const slowStops = await identifySlowStops(executions)

    return new Response(JSON.stringify({
      success: true,
      executions_found: executions.length,
      performance_records_updated: updated,
      update_errors: errors,
      slow_stops_identified: slowStops
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Weekly learning error:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}