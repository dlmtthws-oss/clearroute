import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function QuickBooksCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function handleCallback() {
      const code = searchParams.get('code')
      const realmId = searchParams.get('realmId')
      const state = searchParams.get('state')
      const dataCtx = searchParams.get('data')

      if (!code || !realmId) {
        setError('Missing required parameters from QuickBooks')
        setLoading(false)
        return
      }

      if (dataCtx) {
        try {
          const { userId } = JSON.parse(atob(dataCtx))

          const { data, error: callbackError } = await supabase.functions.invoke('qbo-auth-callback', {
            body: { code, realmId, userId, state }
          })

          if (callbackError) {
            console.error('Callback error:', callbackError)
            setError('Failed to complete authentication')
          } else if (data?.success) {
            navigate('/settings?tab=quickbooks', { replace: true })
          } else {
            setError(data?.error || 'Authentication failed')
          }
        } catch (err) {
          console.error('Error:', err)
          setError('Authentication failed')
        }
      } else {
        setError('Missing user context')
      }

      setLoading(false)
    }

    handleCallback()
  }, [searchParams, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Connecting to QuickBooks...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-6 bg-white rounded-lg shadow">
          <h1 className="text-xl font-bold text-red-600 mb-2">Connection Failed</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => navigate('/settings?tab=quickbooks')}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  return null
}