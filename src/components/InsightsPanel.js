import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

const SETUP_SCORE_ITEMS = [
  { key: 'company_details_complete', label: 'Company details', points: 10, icon: '🏢' },
  { key: 'logo_uploaded', label: 'Logo uploaded', points: 5, icon: '🖼️' },
  { key: 'first_customer_added', label: 'First customer', points: 10, icon: '👤' },
  { key: 'first_route_created', label: 'First route', points: 10, icon: '🗺️' },
  { key: 'gocardless_connected', label: 'GoCardless', points: 20, icon: '🏦' },
  { key: 'first_invoice_sent', label: 'First invoice', points: 10, icon: '📄' },
  { key: 'recurring_invoice_set_up', label: 'Recurring invoice', points: 15, icon: '🔄' },
  { key: 'team_member_added', label: 'Team member', points: 10, icon: '👥' },
  { key: 'first_payment_collected', label: 'First payment', points: 10, icon: '💳' },
]

const INDUSTRY_BENCHMARKS = [
  { region: 'London', residential: '£15-25', commercial: '£35-80', notes: 'Highest rates in UK' },
  { region: 'South East', residential: '£12-18', commercial: '£25-60', notes: 'Strong market' },
  { region: 'Midlands', residential: '£8-13', commercial: '£20-45', notes: 'Competitive' },
  { region: 'North West', residential: '£8-12', commercial: '£18-40', notes: 'Growing area' },
  { region: 'North East', residential: '£7-11', commercial: '£16-38', notes: 'Budget-friendly' },
]

const WEEKLY_TIPS = {
  1: [
    { title: 'Add 5 customers', description: 'Unlock route clustering with at least 5 customers', url: '/customers/new' },
    { title: 'Connect GoCardless', description: 'Get automatic payments set up for reliable cash flow', url: '/settings/payments' },
    { title: 'Create your first route', description: 'Organise customers by location for efficiency', url: '/routes/new' },
  ],
  2: [
    { title: 'Set recurring invoices', description: 'Automate billing for regular customers', url: '/invoices/recurring' },
    { title: 'Review pricing', description: 'Check your rates against regional benchmarks', url: '/settings/pricing' },
    { title: 'Add a team member', description: 'Delegate jobs to grow your capacity', url: '/team/invite' },
  ],
  3: [
    { title: 'Enable auto-pay', description: '70% of paid cleaners use GoCardless', url: '/settings/payments' },
    { title: 'Optimise routes', description: 'Use AI to find the fastest order', url: '/routes' },
    { title: 'Send quotes', description: 'Convert leads faster with quick quotes', url: '/quotes/new' },
  ],
  4: [
    { title: 'Review performance', description: 'Check which routes are most profitable', url: '/analytics' },
    { title: 'Add services', description: 'Offer gutters, fascia, or conservatories', url: '/settings/services' },
    { title: 'Set up reminders', description: 'Automated customer reminders', url: '/settings/reminders' },
  ],
}

export default function InsightsPanel({ userId }) {
  const [insights, setInsights] = useState([])
  const [setupScore, setSetupScore] = useState({ total_score: 0 })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('for-you')
  const [dismissing, setDismissing] = useState(null)
  const [weekNumber, setWeekNumber] = useState(1)

  useEffect(() => {
    if (userId) {
      fetchData()
    }
  }, [userId])

  const fetchData = async () => {
    try {
      const [insightsRes, scoreRes, progressRes] = await Promise.all([
        supabase
          .from('onboarding_insights')
          .select('*')
          .eq('user_id', userId)
          .eq('is_dismissed', false)
          .order('priority', { ascending: false })
          .limit(10),
        supabase
          .from('setup_scores')
          .select('*')
          .eq('user_id', userId)
          .single(),
        supabase
          .from('onboarding_progress')
          .select('triggers_data')
          .eq('user_id', userId)
          .single()
      ])

      setInsights(insightsRes.data || [])
      
      if (scoreRes.data) {
        setSetupScore(scoreRes.data)
      }

      if (progressRes.data?.triggers_data?.generated_at) {
        const generated = new Date(progressRes.data.triggers_data.generated_at)
        const now = new Date()
        const diffWeeks = Math.floor((now.getTime() - generated.getTime()) / (1000 * 60 * 60 * 24 * 7))
        setWeekNumber(Math.min(diffWeeks + 1, 4))
      }
    } catch (error) {
      console.error('Error fetching insights:', error)
    } finally {
      setLoading(false)
    }
  }

  const dismissInsight = async (insightId) => {
    setDismissing(insightId)
    try {
      await supabase
        .from('onboarding_insights')
        .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
        .eq('id', insightId)

      setInsights(insights.filter(i => i.id !== insightId))
    } catch (error) {
      console.error('Error dismissing insight:', error)
    } finally {
      setDismissing(null)
    }
  }

  const calculateProgress = () => {
    const completed = SETUP_SCORE_ITEMS.filter(item => setupScore[item.key]).length
    return Math.round((completed / SETUP_SCORE_ITEMS.length) * 100)
  }

  const progress = calculateProgress()
  const pendingItems = SETUP_SCORE_ITEMS.filter(item => !setupScore[item.key])

  const renderSetupScoreRing = () => {
    const size = 120
    const strokeWidth = 10
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (progress / 100) * circumference

    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#4f46e5"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className="text-2xl font-bold text-gray-800">{progress}</span>
          <span className="text-xs text-gray-500">/ 100</span>
        </div>
      </div>
    )
  }

  const renderInsightIcon = (type) => {
    const icons = {
      pricing_suggestion: '💰',
      route_recommendation: '🗺️',
      setup_tip: '💡',
      market_comparison: '📊',
      efficiency_suggestion: '⚡',
      quick_win: '🚀'
    }
    return icons[type] || '💡'
  }

  const renderForYouTab = () => (
    <div className="space-y-3">
      {insights.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-4xl mb-2">🎯</p>
          <p>No insights yet</p>
          <p className="text-sm mt-1">Complete setup steps to see recommendations</p>
        </div>
      ) : (
        insights.map((insight) => (
          <div
            key={insight.id}
            className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{renderInsightIcon(insight.insight_type)}</span>
              <div className="flex-1">
                <h4 className="font-medium text-gray-800">{insight.title}</h4>
                <p className="text-sm text-gray-600 mt-1">{insight.content}</p>
                {insight.action_label && insight.action_url && (
                  <a
                    href={insight.action_url}
                    className="inline-block mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    {insight.action_label} →
                  </a>
                )}
              </div>
              <button
                onClick={() => dismissInsight(insight.id)}
                disabled={dismissing === insight.id}
                className="text-gray-400 hover:text-gray-600"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )

  const renderBenchmarksTab = () => (
    <div className="space-y-4">
      <div className="bg-indigo-50 p-4 rounded-lg">
        <h4 className="font-medium text-indigo-800 mb-1">UK Window Cleaning Rates</h4>
        <p className="text-sm text-indigo-600">Based on 2024 market data</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 font-medium text-gray-600">Region</th>
              <th className="text-left py-2 font-medium text-gray-600">Residential</th>
              <th className="text-left py-2 font-medium text-gray-600">Commercial</th>
            </tr>
          </thead>
          <tbody>
            {INDUSTRY_BENCHMARKS.map((row, index) => (
              <tr key={index} className="border-b border-gray-100">
                <td className="py-2 text-gray-800">{row.region}</td>
                <td className="py-2 text-green-600">{row.residential}</td>
                <td className="py-2 text-blue-600">{row.commercial}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-4">* Prices per property, per clean</p>
    </div>
  )

  const renderChecklistTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-medium text-gray-800">Setup Checklist</h4>
          <p className="text-sm text-gray-500">{pendingItems.length} items remaining</p>
        </div>
        {renderSetupScoreRing()}
      </div>

      <div className="space-y-2">
        {SETUP_SCORE_ITEMS.map((item) => {
          const completed = setupScore[item.key]
          return (
            <div
              key={item.key}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                completed ? 'bg-green-50' : 'bg-gray-50'
              }`}
            >
              <span className="text-lg">{completed ? '✅' : '⬜'}</span>
              <div className="flex-1">
                <span className={completed ? 'text-gray-600 line-through' : 'text-gray-800'}>
                  {item.label}
                </span>
              </div>
              <span className="text-sm text-gray-500">+{item.points}</span>
            </div>
          )
        })}
      </div>

      {pendingItems.length > 0 && (
        <div className="mt-6">
          <h5 className="font-medium text-gray-800 mb-3">Quick Actions</h5>
          <div className="space-y-2">
            {pendingItems.slice(0, 3).map((item) => (
              <a
                key={item.key}
                href={item.url || '/settings'}
                className="block p-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                <span className="text-lg mr-2">{item.icon}</span>
                <span className="text-indigo-700 font-medium">Complete {item.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Getting Started Insights</h2>
            <p className="text-sm text-gray-500">Week {weekNumber} of your ClearRoute journey</p>
          </div>
          {renderSetupScoreRing()}
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex">
          <button
            onClick={() => setActiveTab('for-you')}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'for-you'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            For You {insights.length > 0 && (
              <span className="ml-1 px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full text-xs">
                {insights.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('benchmarks')}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'benchmarks'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Industry Benchmarks
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'checklist'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Setup Checklist {pendingItems.length > 0 && (
              <span className="ml-1 px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs">
                {pendingItems.length}
              </span>
            )}
          </button>
        </nav>
      </div>

      <div className="p-4">
        {activeTab === 'for-you' && renderForYouTab()}
        {activeTab === 'benchmarks' && renderBenchmarksTab()}
        {activeTab === 'checklist' && renderChecklistTab()}
      </div>
    </div>
  )
}