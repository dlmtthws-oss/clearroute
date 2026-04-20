import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { createBillingRequest, getMandate, cancelMandate } from '../lib/gocardless'

export default function GoCardlessMandateSection({ customer, onStatusChange }) {
  const [mandate, setMandate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    if (customer?.id) {
      loadMandate()
    }
  }, [customer?.id])

  const loadMandate = async () => {
    setLoading(true)
    const data = await getMandate(customer.id)
    setMandate(data)
    setLoading(false)
  }

  const handleSetup = async () => {
    setSettingUp(true)
    const result = await createBillingRequest(customer.id, {
      name: customer.name,
      email: customer.email,
      address_line_1: customer.address_line_1,
      city: customer.city,
      postcode: customer.postcode
    })

    if (result?.redirect_url) {
      window.open(result.redirect_url, '_blank')
      setShowConfirm(true)
    } else if (result?.error) {
      alert('Error: ' + result.error)
    }
    setSettingUp(false)
  }

  const handleCancel = async () => {
    if (!window.confirm('Cancel this Direct Debit mandate?')) return
    const result = await cancelMandate(mandate.id)
    if (result?.success) {
      loadMandate()
      if (onStatusChange) onStatusChange('cancelled')
    }
  }

  const getStatusBadge = (status) => {
    switch(status) {
      case 'active': return 'bg-green-100 text-green-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'cancelled': return 'bg-red-100 text-red-800'
      case 'failed': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading...</div>
  }

  return (
    <div className="border rounded-lg p-4">
      <h4 className="font-medium mb-3">Direct Debit (GoCardless)</h4>
      
      {mandate ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(mandate.status)}`}>
              {mandate.status}
            </span>
            {mandate.reference && (
              <span className="text-sm text-gray-500">Ref: {mandate.reference}</span>
            )}
          </div>
          
          {mandate.status === 'cancelled' && (
            <button
              onClick={loadMandate}
              className="text-sm text-blue-600 hover:underline"
            >
              Refresh status
            </button>
          )}
          
          {mandate.status === 'active' && (
            <button
              onClick={handleCancel}
              className="text-sm text-red-600 hover:underline"
            >
              Cancel mandate
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Set up Direct Debit to collect payments automatically
          </p>
          <button
            onClick={handleSetup}
            disabled={settingUp}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {settingUp ? 'Setting up...' : 'Set Up Direct Debit'}
          </button>
        </div>
      )}

      {showConfirm && (
        <div className="mt-3 p-3 bg-blue-50 rounded text-sm">
          <p className="text-blue-700">
            Complete the setup on the GoCardless page, then click below to refresh
          </p>
          <button
            onClick={() => { setShowConfirm(false); loadMandate(); }}
            className="mt-2 text-blue-600 hover:underline"
          >
            I've completed the setup - refresh status
          </button>
        </div>
      )}
    </div>
  )
}