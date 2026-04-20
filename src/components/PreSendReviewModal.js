import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function PreSendReviewModal({ invoiceId, onSend, onReview, onCancel }) {
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState([])
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (invoiceId) {
      runCompletenessCheck()
    }
  }, [invoiceId])

  const runCompletenessCheck = async () => {
    setLoading(true)
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invoice-writing-assistant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            action: 'check-invoice-completeness',
            invoice_id: invoiceId
          })
        }
      )

      if (response.ok) {
        const result = await response.json()
        setChecks(result.checks || [])
        setSummary(result.summary)
      } else {
        const defaultChecks = [
          { check: 'Loading checks...', status: 'pass', message: 'Please wait' }
        ]
        setChecks(defaultChecks)
      }
    } catch (err) {
      console.error('Check failed:', err)
      const defaultChecks = [
        { check: 'Could not run checks', status: 'warn', message: 'Please review manually' }
      ]
      setChecks(defaultChecks)
    }
    setLoading(false)
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pass':
        return (
          <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )
      case 'warn':
        return (
          <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )
      case 'fail':
        return (
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        )
      default:
        return null
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'pass':
        return 'bg-green-50 border-green-200'
      case 'warn':
        return 'bg-yellow-50 border-yellow-200'
      case 'fail':
        return 'bg-red-50 border-red-200'
      default:
        return 'bg-gray-50 border-gray-200'
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <span className="ml-3 text-gray-600">Running checks...</span>
          </div>
        </div>
      </div>
    )
  }

  const assessmentText = () => {
    switch (summary?.assessment) {
      case 'ready':
        return 'This invoice appears ready to send.'
      case 'review_recommended':
        return 'Some items need attention before sending.'
      case 'needs_review':
        return 'Several issues need to be resolved.'
      default:
        return 'Please review before sending.'
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Pre-Send Review
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            AI Completeness Check
          </p>
        </div>

        <div className="px-6 py-4">
          <div className={`p-4 rounded-lg mb-4 ${
            summary?.failing > 0 
              ? 'bg-red-50 border border-red-200' 
              : summary?.warnings > 0
              ? 'bg-yellow-50 border border-yellow-200'
              : 'bg-green-50 border border-green-200'
          }`}>
            <div className="flex items-center gap-2">
              {summary?.failing > 0 ? (
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              ) : summary?.warnings > 0 ? (
                <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              <span className="font-medium">{assessmentText()}</span>
            </div>
            <div className="text-sm text-gray-600 mt-2">
              {summary?.passing} passed, {summary?.warnings} warnings, {summary?.failing} failed
            </div>
          </div>

          <div className="space-y-2">
            {checks.map((check, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg border ${getStatusColor(check.status)}`}
              >
                {getStatusIcon(check.status)}
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {check.check}
                  </div>
                  <div className="text-xs text-gray-600">
                    {check.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
          >
            Cancel
          </button>
          {summary?.failing > 0 && (
            <button
              type="button"
              onClick={onReview}
              className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
            >
              Review Invoice
            </button>
          )}
          <button
            type="button"
            onClick={onSend}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            {summary?.failing > 0 ? 'Send Anyway' : 'Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}