import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const CHECKLIST_KEY = 'clearroute_checklist_dismissed'

const checklistItems = [
  { id: 'logo', label: 'Add company logo', path: '/settings' },
  { id: 'customers', label: 'Import your customers', path: '/customers/import' },
  { id: 'invoice', label: 'Create your first invoice', path: '/invoices/new' },
  { id: 'gocardless', label: 'Set up GoCardless', path: '/settings' },
  { id: 'team', label: 'Add all team members', path: '/workers' },
  { id: 'recurring', label: 'Create a recurring invoice', path: '/invoices/recurring' }
]

export default function GettingStartedChecklist({ user }) {
  const navigate = useNavigate()
  const [completed, setCompleted] = useState([])
  const [isOpen, setIsOpen] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkCompletion()
  }, [])

  async function checkCompletion() {
    setLoading(true)

    const completedItems = new Set()

    const { data: settings } = await supabase
      .from('company_settings')
      .select('logo_url')
      .limit(1)
      .single()

    if (settings?.logo_url) {
      completedItems.add('logo')
    }

    const { count: customerCount } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })

    if (customerCount && customerCount > 0) {
      completedItems.add('customers')
    }

    const { count: invoiceCount } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })

    if (invoiceCount && invoiceCount > 0) {
      completedItems.add('invoice')
    }

    const { data: gcSettings } = await supabase
      .from('company_settings')
      .select('gocardless_access_token')
      .limit(1)
      .single()

    if (gcSettings?.gocardless_access_token) {
      completedItems.add('gocardless')
    }

    const { count: workerCount } = await supabase
      .from('workers')
      .select('*', { count: 'exact', head: true })

    if (workerCount && workerCount > 1) {
      completedItems.add('team')
    }

    const { count: recurringCount } = await supabase
      .from('recurring_invoice_templates')
      .select('*', { count: 'exact', head: true })

    if (recurringCount && recurringCount > 0) {
      completedItems.add('recurring')
    }

    setCompleted([...completedItems])

    // Auto-dismiss if all complete
    if (completedItems.size === checklistItems.length) {
      setIsOpen(false)
    }

    // Check if previously dismissed
    const dismissed = localStorage.getItem(CHECKLIST_KEY)
    if (dismissed) {
      setIsOpen(false)
    }

    setLoading(false)
  }

  function handleDismiss() {
    setIsOpen(false)
    localStorage.setItem(CHECKLIST_KEY, new Date().toISOString())
  }

  const progress = checklistItems.length > 0 
    ? Math.round((completed.length / checklistItems.length) * 100) 
    : 100

  if (loading || !isOpen || user?.role !== 'admin') {
    return null
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm mb-6">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <span className="text-xl">🚀</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Getting Started</h3>
              <p className="text-sm text-gray-500">{completed.length} of {checklistItems.length} complete</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600"
            title="Hide this"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {isOpen && (
        <div className="p-4">
          <ul className="space-y-2">
            {checklistItems.map(item => {
              const isComplete = completed.includes(item.id)
              return (
                <li key={item.id}>
                  <button
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                      isComplete 
                        ? 'bg-green-50 text-green-700' 
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-sm ${
                      isComplete 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-200 text-gray-400'
                    }`}>
                      {isComplete ? '✓' : '○'}
                    </span>
                    <span className={isComplete ? 'line-through' : ''}>{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}