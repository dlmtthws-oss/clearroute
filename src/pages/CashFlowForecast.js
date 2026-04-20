import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart, ReferenceLine } from 'recharts'
import { supabase } from '../lib/supabase'

export default function CashFlowForecast({ user }) {
  const [forecast, setForecast] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [summary, setSummary] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [recommendations, setRecommendations] = useState([])
  const [riskPeriods, setRiskPeriods] = useState([])
  const [periodDays, setPeriodDays] = useState(30)

  const isWorker = user?.role === 'worker'

  useEffect(() => {
    if (!isWorker) {
      loadForecast()
    }
  }, [isWorker])

  async function loadForecast() {
    setLoading(true)
    const { data } = await supabase
      .from('cash_flow_forecasts')
      .select('*')
      .order('forecast_date', { ascending: false })
      .limit(1)
    
    if (data?.[0]) {
      setForecast(data[0].forecast_data || [])
      setSummary(data[0].ai_summary || '')
      setConfidence(data[0].confidence_score || 0)
      setRecommendations(data[0].ai_recommendations || [])
    }
    setLoading(false)
  }

  async function regenerateForecast() {
    setGenerating(true)
    try {
      await supabase.functions.invoke('generate-cash-flow-forecast', {
        body: { userId: user?.id }
      })
      await loadForecast()
    } catch (err) {
      console.error('Forecast error:', err)
    } finally {
      setGenerating(false)
    }
  }

  const formatCurrency = (value) => `£${(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  const formatDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const chartData = forecast.slice(0, periodDays).map(d => ({
    ...d,
    dateFormatted: formatDate(d.date)
  }))

  const getConfidenceColor = () => {
    if (confidence >= 0.75) return 'text-green-600'
    if (confidence >= 0.5) return 'text-amber-600'
    return 'text-red-600'
  }

  const getPriorityColor = (priority) => {
    if (priority === 'high') return 'border-l-red-500 bg-red-50'
    if (priority === 'medium') return 'border-l-amber-500 bg-amber-50'
    return 'border-l-blue-500 bg-blue-50'
  }

  if (isWorker) {
    return <div className="p-6 text-center text-gray-500">Cash flow forecasting is not available for field workers.</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Flow Forecast</h1>
          <p className="text-gray-500">AI-powered 90-day financial predictions</p>
        </div>
        <button
          onClick={regenerateForecast}
          disabled={generating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {generating ? (
            <>
              <span className="animate-spin">⏳</span>
              Generating...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Regenerate Forecast
            </>
          )}
        </button>
      </div>

      {loading ? (
        <div className="h-96 flex items-center justify-center">
          <div className="animate-spin text-4xl">⏳</div>
        </div>
      ) : forecast.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-semibold text-gray-800">No forecast available</h3>
          <p className="text-gray-500 mb-4">Generate your first cash flow forecast</p>
          <button
            onClick={regenerateForecast}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Generate Forecast
          </button>
        </div>
      ) : (
        <>
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-800">AI Summary</h3>
              <span className={`px-2 py-1 rounded text-sm font-medium ${getConfidenceColor()}`}>
                {confidence >= 0.75 ? 'High confidence' : confidence >= 0.5 ? 'Medium confidence' : 'Low confidence'}
              </span>
            </div>
            <p className="text-gray-700">{summary || 'No summary available'}</p>
          </div>

          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">Forecast Chart</h3>
              <div className="flex gap-2">
                {[30, 60, 90].map(days => (
                  <button
                    key={days}
                    onClick={() => setPeriodDays(days)}
                    className={`px-3 py-1 rounded text-sm ${
                      periodDays === days ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis 
                  dataKey="dateFormatted" 
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.split(' ')[0]}
                  interval={Math.floor(periodDays / 5)}
                />
                <YAxis 
                  tickFormatter={formatCurrency}
                  tick={{ fontSize: 11 }}
                  width={60}
                />
                <Tooltip 
                  formatter={(value) => formatCurrency(value)}
                  labelFormatter={(label) => label}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB' }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="balance"
                  fill="#DBEAFE"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  name="Running Balance"
                  fillOpacity={0.3}
                />
                <Line
                  type="monotone"
                  dataKey="expectedRevenue"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  name="Expected Revenue"
                />
                <Line
                  type="monotone"
                  dataKey="expectedExpenses"
                  stroke="#EF4444"
                  strokeWidth={2}
                  dot={false}
                  name="Expected Expenses"
                />
                <ReferenceLine y={500} stroke="#F59E0B" strokeDasharray="5 5" label={{ value: 'Min Balance', fontSize: 10, fill: '#F59E0B' }} />
                <ReferenceLine y={0} stroke="#EF4444" strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {riskPeriods?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="font-semibold text-red-800 mb-3">⚠️ Risk Periods Identified</h3>
              <div className="space-y-2">
                {riskPeriods.map((risk, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-700">
                    <span className="text-red-500">•</span>
                    <span>{risk.start_date} - {risk.end_date}: {risk.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recommendations?.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-800">AI Recommendations</h3>
              {recommendations.map((rec, i) => (
                <div key={i} className={`p-4 rounded-lg border-l-4 ${getPriorityColor(rec.priority)}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      rec.priority === 'high' ? 'bg-red-100 text-red-700' :
                      rec.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {rec.priority?.toUpperCase()}
                    </span>
                    <span className="font-medium text-gray-800">{rec.recommendation}</span>
                  </div>
                  <p className="text-sm text-gray-600">{rec.action}</p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500">
            <strong>Disclaimer:</strong> This forecast is based on historical patterns and known commitments. 
            Actual results may vary. Confidence decreases for dates further in the future.
          </div>
        </>
      )}
    </div>
  )
}