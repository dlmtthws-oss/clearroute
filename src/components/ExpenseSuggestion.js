import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ExpenseSuggestionCard({ 
  suggestion, 
  onAccept, 
  onEdit,
  visible 
}: {
  suggestion: {
    category: string
    vatReclaimable: boolean
    confidence: number
    source: string
    reasoning: string
    suggestedDescription?: string
  } | null
  onAccept: () => void
  onEdit: () => void
  visible: boolean
}) {
  if (!visible || !suggestion) return null

  const confidencePct = Math.round(suggestion.confidence * 100)
  const sourceIcon = { rule: '📋', history: '📊', ai: '🤖' }[suggestion.source] || '🤖'

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{sourceIcon}</span>
          <span className="font-medium text-blue-800">AI Suggestion</span>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          confidencePct >= 85 ? 'bg-green-100 text-green-700' :
          confidencePct >= 60 ? 'bg-amber-100 text-amber-700' :
          'bg-red-100 text-red-700'
        }`}>
          {confidencePct}% confident
        </span>
      </div>
      
      <div className="text-sm mb-2">
        <span className="font-medium text-gray-800">Category: </span>
        <span className="text-gray-600 capitalize">{suggestion.category}</span>
        {suggestion.source !== 'rule' && (
          <span className="ml-2 text-gray-400">• VAT {suggestion.vatReclaimable ? ' reclaimable' : ' not reclaimable'}</span>
        )}
      </div>

      <p className="text-sm text-gray-600 mb-3">{suggestion.reasoning}</p>

      <div className="flex gap-2">
        <button
          onClick={onAccept}
          className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
        >
          ✓ Accept
        </button>
        <button
          onClick={onEdit}
          className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 text-sm"
        >
          Edit
        </button>
      </div>
    </div>
  )
}

export function useExpenseSuggestion() {
  const [suggestion, setSuggestion] = useState<{
    category: string
    vatReclaimable: boolean
    confidence: number
    source: string
    reasoning: string
    suggestedDescription?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)

  async function getSuggestion(description: string, supplier?: string, amount?: number, vatAmount?: number) {
    if ((!supplier || supplier.length < 3) && (!description || description.length < 5)) {
      setSuggestion(null)
      return null
    }

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('suggest-expense-category', {
        body: {
          description,
          supplier,
          amount,
          vatAmount
        }
      })

      if (error) throw error
      setSuggestion(data)
      return data
    } catch (err) {
      console.error('Suggestion error:', err)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function logFeedback(expenseId: string, accepted: boolean, actualCategory?: string, actualVat?: boolean) {
    if (!suggestion) return

    await supabase.from('expense_categorisation_feedback').insert({
      expense_id: expenseId,
      suggested_category: suggestion.category,
      suggested_vat_reclaimable: suggestion.vatReclaimable,
      accepted,
      actual_category: actualCategory || suggestion.category,
      actual_vat_reclaimable: actualVat ?? suggestion.vatReclaimable
    })
  }

  async function createRule(userId: string, pattern: string, patternType: 'supplier' | 'description', category: string, vatReclaimable: boolean) {
    await supabase.from('expense_categorisation_rules').insert({
      user_id: userId,
      pattern,
      pattern_type: patternType,
      suggested_category: category,
      suggested_vat_reclaimable: vatReclaimable,
      confidence: 0.95,
      created_by: 'user'
    })
  }

  return { suggestion, loading, getSuggestion, logFeedback, createRule }
}