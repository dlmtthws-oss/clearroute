import { supabase } from './supabase'

const EDGE_FUNCTION_URL = process.env.REACT_APP_SUPABASE_URL
  ? `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/generate-onboarding-insights`
  : null

const TRIGGERS = {
  WIZARD_COMPLETED: 'wizard_completed',
  FIRST_5_CUSTOMERS: 'first_5_customers',
  FIRST_ROUTE: 'first_route',
  FIRST_INVOICE: 'first_invoice',
  FIRST_WEEK: 'first_week',
  MANUAL: 'manual'
}

export async function triggerOnboardingInsights(trigger = TRIGGERS.MANUAL) {
  if (!EDGE_FUNCTION_URL) {
    console.warn('Edge function URL not configured')
    return { success: false, error: 'Not configured' }
  }

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
        'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        user_id: user.id,
        trigger
      })
    })

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error triggering onboarding insights:', error)
    return { success: false, error: error.message }
  }
}

export async function getOnboardingInsights() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('onboarding_insights')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_dismissed', false)
      .order('priority', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching insights:', error)
    return []
  }
}

export async function dismissInsight(insightId) {
  try {
    const { error } = await supabase
      .from('onboarding_insights')
      .update({
        is_dismissed: true,
        dismissed_at: new Date().toISOString()
      })
      .eq('id', insightId)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error dismissing insight:', error)
    return { success: false, error: error.message }
  }
}

export async function getSetupScore() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('setup_scores')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }

    return data
  } catch (error) {
    console.error('Error fetching setup score:', error)
    return null
  }
}

async function updateMilestone(milestone) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.rpc('update_setup_milestone', {
      p_user_id: user.id,
      milestone
    })
  } catch (error) {
    console.error('Error updating milestone:', error)
  }
}

export const milestones = {
  COMPANY_DETAILS: 'company_details_complete',
  LOGO: 'logo_uploaded',
  FIRST_CUSTOMER: 'first_customer_added',
  FIRST_ROUTE: 'first_route_created',
  GOCARDLESS: 'gocardless_connected',
  FIRST_INVOICE: 'first_invoice_sent',
  RECURRING_INVOICE: 'recurring_invoice_set_up',
  TEAM_MEMBER: 'team_member_added',
  FIRST_PAYMENT: 'first_payment_collected'
}

export const trackMilestone = async (milestone) => {
  await updateMilestone(milestone)
  
  const triggerMap = {
    [milestones.FIRST_CUSTOMER]: TRIGGERS.FIRST_5_CUSTOMERS,
    [milestones.FIRST_ROUTE]: TRIGGERS.FIRST_ROUTE,
    [milestones.FIRST_INVOICE]: TRIGGERS.FIRST_INVOICE,
    [milestones.COMPANY_DETAILS]: TRIGGERS.WIZARD_COMPLETED,
    [milestones.GOCARDLESS]: TRIGGERS.WIZARD_COMPLETED
  }

  const trigger = triggerMap[milestone]
  if (trigger) {
    setTimeout(() => {
      triggerOnboardingInsights(trigger)
    }, 1000)
  }
}

export default {
  triggerOnboardingInsights,
  getOnboardingInsights,
  dismissInsight,
  getSetupScore,
  trackMilestone,
  milestones,
  TRIGGERS
}