import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function OnboardingInsights({ user, showFullPanel = false }) {
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(true)
  const [score, setScore] = useState(0)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    if (user?.id) {
      loadInsights()
    }
  }, [user?.id])

  const loadInsights = async () => {
    setLoading(true)
    const [{ data: insightsData }, { data: scoreData }] = await Promise.all([
      supabase.from('onboarding_insights').select('*').eq('user_id', user.id).order('priority', { ascending: true }),
      supabase.from('setup_score').select('score').eq('user_id', user.id).single()
    ])
    setInsights(insightsData || [])
    setScore(scoreData?.score || 0)
    setLoading(false)
  }

  const generateInsights = async () => {
    await supabase.functions.invoke('generate-onboarding-insights')
    loadInsights()
  }

  const dismissInsight = async (id) => {
    await supabase.from('onboarding_insights').update({
      is_dismissed: true,
      dismissed_at: new Date().toISOString()
    }).eq('id', id)
    loadInsights()
  }

  const getIcon = (type) => {
    const icons = {
      pricing_suggestion: '💰',
      route_recommendation: '🗺️',
      setup_tip: '💡',
      market_comparison: '📊',
      efficiency_suggestion: '⚡',
      quick_win: '🎯'
    }
    return icons[type] || '💡'
  }

  const scoreColor = () => {
    if (score >= 80) return 'text-green-600'
    if (score >= 50) return 'text-amber-600'
    return 'text-red-600'
  }

  if (loading) {
    return (
      <div className="p-4 border border-gray-200 rounded-lg animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
        <div className="h-3 bg-gray-200 rounded w-2/3"></div>
      </div>
    )
  }

  if (insights.length === 0 && !showFullPanel) return null

  if (!showFullPanel && insights.length > 0) {
    return (
      <div className="border-2 border-blue-200 bg-blue-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-blue-900">🎯 Getting Started Insights</h3>
          <div className="text-2xl font-bold" style={{ color: scoreColor() }}>{score}</div>
        </div>
        <p className="text-sm text-blue-700 mb-3">Your setup score • Tap to see recommendations</p>
        <button
          onClick={generateInsights}
          className="text-sm text-blue-600 underline"
        >
          Refresh insights
        </button>
      </div>
    )
  }

  if (!showFullPanel) return null

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">🎯 Getting Started Insights</h2>
          <div className="text-right">
            <div className={`text-3xl font-bold ${scoreColor()}`}>{score}</div>
            <div className="text-sm text-gray-500">Setup Score</div>
          </div>
        </div>
        <p className="text-gray-600 mb-4">
          Based on your setup, here are personalized recommendations to help you get maximum value from ClearRoute.
        </p>
        <button
          onClick={generateInsights}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          Generate New Insights
        </button>
      </div>

      <div className="grid gap-4">
        {insights.map((insight, index) => (
          <div 
            key={insight.id} 
            className={`bg-white border rounded-lg overflow-hidden ${
              expanded === index ? 'border-blue-500 shadow-md' : 'border-gray-200'
            }`}
          >
            <button
              onClick={() => setExpanded(expanded === index ? null : index)}
              className="w-full p-4 flex items-start justify-between text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{getIcon(insight.insight_type)}</span>
                <div>
                  <h3 className="font-medium text-gray-900">{insight.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{insight.content}</p>
                </div>
              </div>
              <svg 
                className={`w-5 h-5 text-gray-400 transition-transform ${expanded === index ? 'rotate-180' : ''}`} 
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expanded === index && (
              <div className="px-4 pb-4 border-t pt-4">
                <p className="text-gray-700 mb-4">{insight.content}</p>
                <div className="flex items-center justify-between">
                  {insight.action_label && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                      {insight.action_label} →
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      dismissInsight(insight.id)
                    }}
                    className="text-gray-500 hover:text-gray-700 text-sm"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {insights.length < 3 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="font-medium text-gray-700 mb-2">📊 Industry Benchmarks</h4>
          <div className="text-sm text-gray-600 space-y-1">
            <p>Typical UK window cleaning rates vary by region:</p>
            <ul className="list-disc list-inside ml-2 space-y-1 mt-2">
              <li><span className="font-medium">London:</span> £15-25/property</li>
              <li><span className="font-medium">South East:</span> £12-18/property</li>
              <li><span className="font-medium">Midlands:</span> £8-13/property</li>
              <li><span className="font-medium">North West:</span> £8-12/property</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}