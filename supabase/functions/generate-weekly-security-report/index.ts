import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const { data: events } = await supabase
      .from('risk_events')
      .select('*')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false })

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
    const byType: Record<string, number> = {}
    const byStatus = { open: 0, investigating: 0, resolved: 0, false_positive: 0 }
    const recentCritical = []

    for (const event of events || []) {
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1
      byType[event.event_type] = (byType[event.event_type] || 0) + 1
      byStatus[event.status] = (byStatus[event.status] || 0) + 1

      if (event.severity === 'critical' || event.severity === 'high') {
        recentCritical.push(event)
      }
    }

    const report = {
      period: { start: sevenDaysAgo.toISOString(), end: new Date().toISOString() },
      summary: {
        total_events: events?.length || 0,
        by_severity: bySeverity,
        by_type: byType,
        by_status: byStatus
      },
      security_score: calculateSecurityScore(bySeverity, byStatus),
      critical_events: recentCritical.slice(0, 10),
      recommendations: generateRecommendations(bySeverity, byStatus)
    }

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}

function calculateSecurityScore(bySeverity: Record<string, number>, byStatus: Record<string, number>): number {
  let score = 100

  score -= (bySeverity.critical || 0) * 20
  score -= (bySeverity.high || 0) * 10
  score -= (bySeverity.medium || 0) * 5
  score -= (bySeverity.low || 0) * 2

  score += (byStatus.resolved || 0) * 2

  return Math.max(0, Math.min(100, score))
}

function generateRecommendations(bySeverity: Record<string, number>, byStatus: Record<string, number>): string[] {
  const recommendations: string[] = []

  if ((bySeverity.critical || 0) > 0) {
    recommendations.push('URGENT: Review critical events immediately - possible fraud detected')
  }

  if ((bySeverity.high || 0) > 3) {
    recommendations.push('High number of high-severity events - consider reviewing user access controls')
  }

  const unresolvedRate = (byStatus.open || 0) / ((byStatus.open || 0) + (byStatus.resolved || 0) + 0.01)
  if (unresolvedRate > 0.5) {
    recommendations.push('High unresolved event rate - prioritize event resolution')
  }

  if (recommendations.length === 0) {
    recommendations.push('No immediate action required - system operating normally')
  }

  return recommendations
}