import React from 'react'

const SCORE_ITEMS = [
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

export default function SetupScoreVisual({ score = 0, breakdown = null, size = 'md', showDetails = false }) {
  const sizeClasses = {
    sm: { ring: 60, stroke: 6, text: 'text-lg' },
    md: { ring: 100, stroke: 8, text: 'text-2xl' },
    lg: { ring: 140, stroke: 12, text: 'text-4xl' },
  }

  const config = sizeClasses[size]
  const radius = (config.ring - config.stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(score, 100) / 100) * circumference

  const getProgressColor = () => {
    if (score >= 80) return '#10b981'
    if (score >= 50) return '#f59e0b'
    return '#6366f1'
  }

  const getProgressLabel = () => {
    if (score >= 100) return 'Complete!'
    if (score >= 80) return 'Almost there'
    if (score >= 50) return 'Getting there'
    if (score >= 20) return 'Just started'
    return 'Begin setup'
  }

  const completedItems = breakdown
    ? SCORE_ITEMS.filter(item => breakdown[item.key])
    : []
  const pendingItems = breakdown
    ? SCORE_ITEMS.filter(item => !breakdown[item.key])
    : SCORE_ITEMS

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: config.ring, height: config.ring }}>
        <svg
          width={config.ring}
          height={config.ring}
          className="transform -rotate-90"
        >
          <circle
            cx={config.ring / 2}
            cy={config.ring / 2}
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={config.stroke}
            fill="none"
          />
          <circle
            cx={config.ring / 2}
            cy={config.ring / 2}
            r={radius}
            stroke={getProgressColor()}
            strokeWidth={config.stroke}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold ${config.text}`}>{score}</span>
          <span className="text-xs text-gray-400">{getProgressLabel()}</span>
        </div>
      </div>

      {showDetails && breakdown && (
        <div className="mt-4 w-full max-w-xs">
          <div className="grid grid-cols-2 gap-2">
            {completedItems.length > 0 && (
              <div className="col-span-2 mb-2">
                <p className="text-xs text-gray-500 uppercase mb-1">Completed</p>
                <div className="flex flex-wrap gap-1">
                  {completedItems.map(item => (
                    <span
                      key={item.key}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs"
                    >
                      {item.icon} {item.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {pendingItems.length > 0 && (
              <div className="col-span-2">
                <p className="text-xs text-gray-500 uppercase mb-1">Next Steps</p>
                <div className="flex flex-wrap gap-1">
                  {pendingItems.slice(0, 4).map(item => (
                    <span
                      key={item.key}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs"
                    >
                      {item.icon} {item.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}