import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function BusinessInsights({ user }) {
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [selectedInsight, setSelectedInsight] = useState(null)
  const [query, setQuery] = useState('')
  const [queryResult, setQueryResult] = useState('')
  const [querying, setQuerying] = useState(false)
  const [view, setView] = useState<'insights' | 'query'>('insights')

  const isWorker = user?.role === 'worker'
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!isWorker) {
      loadInsights()
    }
  }, [isWorker])

  async function loadInsights() {
    setLoading(true)
    const { data } = await supabase
      .from('business_insights')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(20)
    setInsights(data || [])
    setLoading(false)
  }

  async function generateReport() {
    setGenerating(true)
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    try {
      await supabase.functions.invoke('generate-business-insight', {
        body: {
          insight_type: 'weekly_summary',
          period_start: startDate,
          period_end: endDate
        }
      })
      await loadInsights()
    } catch (err) {
      console.error('Generate error:', err)
    } finally {
      setGenerating(false)
    }
  }

  async function runQuery() {
    if (!query.trim()) return
    setQuerying(true)
    try {
      const { data } = await supabase.functions.invoke('generate-business-insight', {
        body: { query: query.trim() }
      })
      setQueryResult(data?.answer || 'No answer available')
    } catch (err) {
      setQueryResult('Error processing question')
    } finally {
      setQuerying(false)
    }
  }

  const typeLabels = {
    weekly_summary: 'Weekly Summary',
    monthly_review: 'Monthly Review',
    quarterly_analysis: 'Quarterly',
    anomaly_alert: '⚠️ Anomaly',
    milestone: '🎉 Milestone'
  }

  const getTypeColor = (type) => {
    const colors = {
      weekly_summary: 'bg-blue-100 text-blue-700',
      monthly_review: 'bg-purple-100 text-purple-700',
      anomaly_alert: 'bg-red-100 text-red-700'
    }
    return colors[type] || 'bg-gray-100 text-gray-700'
  }

  if (isWorker) {
    return <div className="p-6 text-center text-gray-500">Business insights are not available for field workers.</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Insights</h1>
          <p className="text-gray-500">AI-powered business reporting</p>
        </div>
        {isAdmin && (
          <button
            onClick={generateReport}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? '⏳ Generating...' : '🔄 Generate Report'}
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b">
        <button
          onClick={() => setView('insights')}
          className={`px-4 py-2 font-medium ${view === 'insights' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          Reports
        </button>
        <button
          onClick={() => setView('query')}
          className={`px-4 py-2 font-medium ${view === 'query' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          Ask a Question
        </button>
      </div>

      {view === 'insights' ? (
        <>
          {insights.length === 0 && !loading ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <div className="text-4xl mb-4">📊</div>
              <h3 className="text-lg font-semibold text-gray-800">No insights yet</h3>
              <p className="text-gray-500 mb-4">Generate your first business report</p>
              {isAdmin && (
                <button
                  onClick={generateReport}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Generate Report
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {insights.map(insight => (
                <div 
                  key={insight.id} 
                  className="bg-white border rounded-lg p-6 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedInsight(insight)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeColor(insight.insight_type)}`}>
                      {typeLabels[insight.insight_type] || insight.insight_type}
                    </span>
                    <span className="text-sm text-gray-500">
                      {new Date(insight.period_start).toLocaleDateString('en-GB')} - {new Date(insight.period_end).toLocaleDateString('en-GB')}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{insight.headline}</h3>
                  <p className="text-gray-600 line-clamp-2">{insight.narrative?.slice(0, 200)}...</p>
                  {insight.metrics && (
                    <div className="flex gap-4 mt-4 pt-4 border-t">
                      <div>
                        <div className="text-lg font-bold">£{(insight.metrics.revenue || 0).toFixed(0)}</div>
                        <div className="text-xs text-gray-500">Revenue</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{insight.metrics.collectionRate?.toFixed(0)}%</div>
                        <div className="text-xs text-gray-500">Collection</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{insight.metrics.newCustomers || 0}</div>
                        <div className="text-xs text-gray-500">New Customers</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ask a question about your business
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runQuery()}
                placeholder="e.g. What was my best month this year?"
                className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={runQuery}
                disabled={querying || !query.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {querying ? '⏳' : 'Ask'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Try: "Which customer generates the most revenue?" or "How has my profit margin changed?"
            </p>
          </div>

          {queryResult && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🤖</span>
                <span className="font-semibold text-blue-800">Answer</span>
              </div>
              <div className="prose prose-blue max-w-none" style={{ whiteSpace: 'pre-wrap' }}>
                {queryResult}
              </div>
            </div>
          )}

          <div className="text-sm text-gray-500">
            <p>Example questions you can ask:</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>"Which customer generates the most revenue?"</li>
              <li>"How has my revenue changed over the quarter?"</li>
              <li>"What is my collection rate?"</li>
              <li>"Which routes take the most time?"</li>
            </ul>
          </div>
        </div>
      )}

      {selectedInsight && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedInsight(null)}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Full Report</h3>
              <button onClick={() => setSelectedInsight(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500 mb-1">
                  {new Date(selectedInsight.period_start).toLocaleDateString('en-GB')} - {new Date(selectedInsight.period_end).toLocaleDateString('en-GB')}
                </p>
                <h4 className="text-lg font-semibold">{selectedInsight.headline}</h4>
              </div>

              <div className="prose">
                {selectedInsight.narrative?.split('\n\n').map((para, i) => (
                  <p key={i} className="mb-4">{para}</p>
                ))}
              </div>

              {(selectedInsight.highlights || []).length > 0 && (
                <div>
                  <h5 className="font-medium text-green-700 mb-2">✓ Highlights</h5>
                  <div className="space-y-2">
                    {(selectedInsight.highlights || []).map((h: any, i: number) => (
                      <div key={i} className="bg-green-50 border-l-4 border-green-400 p-3 rounded">
                        <div className="font-medium">{h.title}</div>
                        <div className="text-sm text-gray-600">{h.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(selectedInsight.concerns || []).length > 0 && (
                <div>
                  <h5 className="font-medium text-amber-700 mb-2">⚠️ Concerns</h5>
                  <div className="space-y-2">
                    {(selectedInsight.concerns || []).map((c: any, i: number) => (
                      <div key={i} className={`border-l-4 p-3 rounded ${
                        c.severity === 'high' ? 'bg-red-50 border-red-400' : 'bg-amber-50 border-amber-400'
                      }`}>
                        <div className="font-medium">{c.title}</div>
                        <div className="text-sm text-gray-600">{c.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(selectedInsight.recommendations || []).length > 0 && (
                <div>
                  <h5 className="font-medium text-blue-700 mb-2">Recommendations</h5>
                  <div className="space-y-2">
                    {(selectedInsight.recommendations || []).map((r: any, i: number) => (
                      <div key={i} className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{i + 1}. {r.action}</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            r.priority === 'high' ? 'bg-red-100 text-red-700' :
                            r.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>{r.priority}</span>
                        </div>
                        <div className="text-sm text-gray-600">{r.rationale}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}