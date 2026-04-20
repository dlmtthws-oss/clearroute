import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const WIZARD_STEPS = [
  { id: 'welcome', title: 'Welcome', tips: [
    { type: 'tip', title: 'Quick Setup', content: 'Complete all steps in under 5 minutes to get the best experience.', priority: 10 },
    { type: 'tip', title: 'Add Your Logo', content: 'Upload your business logo to make invoices look professional.', priority: 8 },
  ]},
  { id: 'company-details', title: 'Company Details', tips: [
    { type: 'tip', title: 'Business Name', content: 'Your business name will appear on all invoices and quotes.', priority: 10 },
    { type: 'tip', title: 'Contact Info', content: 'Add a phone number and email - customers prefer businesses they can reach easily.', priority: 8 },
  ]},
  { id: 'pricing', title: 'Pricing Setup', tips: [
    { type: 'pricing', title: 'Regional Pricing', content: 'London window cleaning averages £15-25 for residential. Check the UK pricing guide.', priority: 10 },
    { type: 'tip', title: 'Commercial Rates', content: 'Commercial properties typically charge 2-3x residential rates.', priority: 9 },
    { type: 'pricing', title: 'Price Gaps', content: 'Setting competitive prices from day one helps attract the right customers.', priority: 8 },
  ]},
  { id: 'customers', title: 'Add Customers', tips: [
    { type: 'tip', title: 'Location Matters', content: 'Add postcodes - ClearRoute uses them to cluster customers into efficient routes.', priority: 10 },
    { type: 'tip', title: '5-Minute Rule', content: 'Add at least 5 customers to see the route clustering benefit.', priority: 9 },
    { type: 'tip', title: 'Service Types', content: 'Note if each customer needs windows, gutters, or both.', priority: 7 },
  ]},
  { id: 'routes', title: 'Create Routes', tips: [
    { type: 'route', title: 'Route Efficiency', content: 'Group customers in the same postcode area to reduce travel time.', priority: 10 },
    { type: 'tip', title: 'Smart Ordering', content: 'ClearRoute AI suggests the best order to visit customers.', priority: 8 },
    { type: 'tip', title: 'Time Estimates', content: 'Set realistic time estimates - starting with 30mins per job is recommended.', priority: 7 },
  ]},
  { id: 'payment', title: 'Payment Setup', tips: [
    { type: 'payment', title: 'GoCardless Setup', content: 'Connect GoCardless to get automatic bank payments. No chasing invoices!', priority: 10 },
    { type: 'tip', title: 'Cash Flow', content: '70% of window cleaners using auto-pay get paid faster.', priority: 9 },
    { type: 'tip', title: 'Payment Terms', content: 'Net 14 or Net 30 terms are standard in the industry.', priority: 7 },
  ]},
  { id: 'complete', title: 'Complete', tips: [
    { type: 'tip', title: 'You\'re Ready!', content: 'Add more customers, create routes, and send your first invoice anytime.', priority: 10 },
    { type: 'tip', title: 'Daily Tip', content: 'Check your insights panel for personalized recommendations.', priority: 8 },
  ]},
]

const UK_PRICING = {
  london: { residential: [15, 25], commercial: [35, 80] },
  south_east: { residential: [12, 18], commercial: [25, 60] },
  midlands: { residential: [8, 13], commercial: [20, 45] },
  north_west: { residential: [8, 12], commercial: [18, 40] },
  north_east: { residential: [7, 11], commercial: [16, 38] },
}

function getPricingTip(region) {
  const data = UK_PRICING[region] || UK_PRICING.midlands
  return `In ${region.replace('_', ' ')}, residential averages £${data.residential[0]}-£${data.residential[1]}.`
}

export default function OnboardingTipsSidebar({ currentStep = 'welcome', onPricingCalculated }) {
  const [tips, setTips] = useState([])
  const [customerCount, setCustomerCount] = useState(0)
  const [region, setRegion] = useState('midlands')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const step = WIZARD_STEPS.find(s => s.id === currentStep) || WIZARD_STEPS[0]
    let stepTips = [...step.tips]

    if (currentStep === 'customers' && customerCount > 0) {
      stepTips = [
        { type: 'success', title: `${customerCount} customers added!`, content: 'Great progress. Keep adding to unlock route clustering.', priority: 10 },
        ...stepTips
      ]
    }

    if (customerCount >= 5) {
      stepTips = [
        { type: 'cluster', title: 'Route clustering available', content: 'With 5+ customers, you can now create efficient routes.', priority: 10 },
        ...stepTips
      ]
    }

    setTips(stepTips)
  }, [currentStep, customerCount])

  useEffect(() => {
    async function fetchCustomerData() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data } = await supabase
          .from('customers')
          .select('postcode')
          .eq('user_id', user.id)

        if (data && data.length > 0) {
          setCustomerCount(data.length)
          const postcodes = data.map(c => c.postcode).filter(Boolean)
          if (postcodes.length > 0) {
            const firstPostcode = postcodes[0].toUpperCase().slice(0, 2)
            if (['SW', 'SE', 'NW', 'NE', 'EC', 'WC', 'W', 'E', 'N'].includes(firstPostcode)) {
              setRegion('london')
            } else if (['KT', 'CR', 'BR', 'DA', 'TN'].includes(firstPostcode)) {
              setRegion('south_east')
            }
          }
        }

        if (onPricingCalculated) {
          onPricingCalculated({ region, customerCount })
        }
      } catch (error) {
        console.error('Error fetching customer data:', error)
      }
    }

    fetchCustomerData()
  }, [region])

  const getTipIcon = (type) => {
    switch (type) {
      case 'pricing': return '💰'
      case 'route': return '🗺️'
      case 'payment': return '🏦'
      case 'success': return '✅'
      case 'cluster': return '🔗'
      default: return '💡'
    }
  }

  const getTipColor = (type) => {
    switch (type) {
      case 'pricing': return 'border-l-yellow-400 bg-yellow-50'
      case 'route': return 'border-l-blue-400 bg-blue-50'
      case 'payment': return 'border-l-green-400 bg-green-50'
      case 'success': return 'border-l-green-500 bg-green-50'
      case 'cluster': return 'border-l-purple-500 bg-purple-50'
      default: return 'border-l-indigo-400 bg-gray-50'
    }
  }

  const sortedTips = [...tips].sort((a, b) => b.priority - a.priority)

  return (
    <div className="w-72 bg-white border-l border-gray-200 h-full overflow-y-auto">
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">Smart Tips</h3>
        <p className="text-sm text-gray-500 mb-4">
          Step: {WIZARD_STEPS.find(s => s.id === currentStep)?.title || currentStep}
        </p>

        <div className="space-y-3">
          {sortedTips.map((tip, index) => (
            <div
              key={index}
              className={`p-3 rounded-r-lg border-l-4 ${getTipColor(tip.type)}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg">{getTipIcon(tip.type)}</span>
                <div>
                  <p className="font-medium text-gray-800 text-sm">{tip.title}</p>
                  <p className="text-gray-600 text-sm mt-1">{tip.content}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {region && (
          <div className="mt-6 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Your Region</p>
            <p className="text-sm text-gray-700 capitalize">{region.replace('_', ' ')}</p>
            <p className="text-xs text-gray-500 mt-2">{getPricingTip(region)}</p>
          </div>
        )}
      </div>
    </div>
  )
}