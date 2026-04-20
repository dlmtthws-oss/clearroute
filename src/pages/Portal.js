import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

export default function Portal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [showPaidHistory, setShowPaidHistory] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(null)

  useEffect(() => {
    async function fetchPortalData() {
      if (!token) {
        setError('Invalid link')
        setLoading(false)
        return
      }

      try {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
        
        const response = await fetch(`${SUPABASE_URL}/functions/v1/get-portal-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portal_token: token }),
        })

        const result = await response.json()

        if (!response.ok) {
          setError(result.error || 'This link is no longer valid. Please contact us.')
          return
        }

        setData(result)
      } catch (err) {
        setError('An error occurred. Please try again.')
      }
      setLoading(false)
    }

    fetchPortalData()
  }, [token])

  const handleDownloadPdf = async (invoiceId, invoiceNumber) => {
    setDownloadingPdf(invoiceId)
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-invoice-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          invoice_id: invoiceId,
          portal_token: token,
        }),
      })

      if (!response.ok) {
        alert('Failed to generate PDF')
        return
      }

      const { pdf_url } = await response.json()
      
      // Download the PDF
      window.open(pdf_url, '_blank')
    } catch (err) {
      alert('Failed to download PDF')
    }
    setDownloadingPdf(null)
  }

  const handleSetupDirectDebit = async () => {
    if (!data?.customer?.email || !data?.customer?.name) {
      alert('Please contact us to set up direct debit')
      return
    }

    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/gocardless-create-billing-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: data.customer.id,
          customer_name: data.customer.name,
          email: data.customer.email,
          address_line_1: data.customer.address_line_1,
          city: data.customer.city,
          postcode: data.customer.postcode,
        }),
      })

      const result = await response.json()

      if (result.hosted_url) {
        window.open(result.hosted_url, '_blank')
      } else {
        alert('Failed to set up direct debit')
      }
    } catch (err) {
      alert('Failed to set up direct debit')
    }
  }

  const handleCancelMandate = async () => {
    if (!window.confirm('Are you sure you want to cancel your direct debit? This cannot be undone.')) {
      return
    }

    alert('Please contact us to cancel your direct debit.')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-4" style={{ borderColor: data?.company?.primary_color || '#3B82F6' }}></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Invalid</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  const { customer, company, invoices, upcoming_visits, mandate } = data
  const primaryColor = company?.primary_color || '#3B82F6'
  const unpaidInvoices = invoices?.filter(inv => inv.status !== 'paid') || []
  const paidInvoices = invoices?.filter(inv => inv.status === 'paid') || []

  const formatDate = (date) => {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const formatMoney = (amount) => `£${(amount || 0).toFixed(2)}`

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="text-white" style={{ backgroundColor: primaryColor }}>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-lg font-bold">{company?.company_name || 'ClearRoute'}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Welcome Banner */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Welcome, {customer?.name}</h2>
          <p className="text-gray-600">
            {[customer?.address_line_1, customer?.address_line_2, customer?.city, customer?.postcode]
              .filter(Boolean)
              .join(', ')}
          </p>
          {customer?.service_type && (
            <p className="text-sm text-gray-500 mt-1">{customer.service_type}</p>
          )}
        </div>

        {/* Invoices */}
        <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoices</h3>
          
          {unpaidInvoices.length === 0 && paidInvoices.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No invoices yet</p>
          ) : unpaidInvoices.length > 0 ? (
            <div className="space-y-3">
              {unpaidInvoices.map(inv => (
                <div 
                  key={inv.id} 
                  className={`p-4 rounded-lg border ${inv.is_overdue ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-gray-900">{inv.invoice_number}</p>
                      <p className="text-sm text-gray-500">
                        Issued: {formatDate(inv.issue_date)} • Due: {formatDate(inv.due_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">{formatMoney(inv.total)}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        inv.is_overdue ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                      }`}>
                        {inv.is_overdue ? 'Overdue' : 'Due'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadPdf(inv.id, inv.invoice_number)}
                    disabled={downloadingPdf === inv.id}
                    className="w-full mt-2 py-2 px-4 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {downloadingPdf === inv.id ? 'Generating...' : 'Download PDF'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {paidInvoices.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowPaidHistory(!showPaidHistory)}
                className="text-sm text-gray-500 flex items-center gap-1"
              >
                <span>{showPaidHistory ? '▼' : '▶'}</span>
                Payment History ({paidInvoices.length} paid)
              </button>
              
              {showPaidHistory && (
                <div className="mt-3 space-y-2">
                  {paidInvoices.map(inv => (
                    <div key={inv.id} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-gray-900">{inv.invoice_number}</p>
                          <p className="text-sm text-gray-500">{formatDate(inv.issue_date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatMoney(inv.total)}</p>
                          <span className="text-xs text-green-700">Paid</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Direct Debit */}
        <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Direct Debit</h3>
          
          {mandate?.status === 'active' ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-xl">✓</span>
              </div>
              <p className="font-medium text-green-800">Direct Debit Active</p>
              <p className="text-sm text-gray-500 mt-1">Your invoices are collected automatically</p>
              {mandate?.reference && (
                <p className="text-xs text-gray-400 mt-2">Ref: {mandate.reference}</p>
              )}
              <button
                onClick={handleCancelMandate}
                className="mt-4 text-sm text-red-600 hover:underline"
              >
                Cancel Direct Debit
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-600 mb-4">Set up a direct debit to have invoices collected automatically</p>
              <button
                onClick={handleSetupDirectDebit}
                className="px-6 py-2 text-white rounded-lg font-medium"
                style={{ backgroundColor: primaryColor }}
              >
                Set Up Direct Debit
              </button>
            </div>
          )}
        </section>

        {/* Upcoming Visits */}
        <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Visits</h3>
          
          {upcoming_visits?.length > 0 ? (
            <div className="space-y-3">
              {upcoming_visits.map(visit => (
                <div key={visit.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-900">{formatDate(visit.scheduled_date)}</p>
                      <p className="text-sm text-gray-500">{visit.route_name}</p>
                    </div>
                    {visit.estimated_duration && (
                      <span className="text-sm text-gray-500">{visit.estimated_duration} mins</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No upcoming visits scheduled. We'll be in touch to arrange your next visit.</p>
          )}
        </section>

        {/* Contact Us */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Us</h3>
          <div className="space-y-2 text-gray-600">
            {company?.company_name && (
              <p className="font-medium text-gray-900">{company.company_name}</p>
            )}
            {company?.company_phone && (
              <p>Phone: <a href={`tel:${company.company_phone}`} className="text-blue-600">{company.company_phone}</a></p>
            )}
            {company?.company_email && (
              <p>Email: <a href={`mailto:${company.company_email}`} className="text-blue-600">{company.company_email}</a></p>
            )}
            {company?.address_line_1 && (
              <p>Address: {[company.address_line_1, company.city, company.postcode].filter(Boolean).join(', ')}</p>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-2xl mx-auto px-4 py-6 text-center text-sm text-gray-400">
        <p>Powered by ClearRoute</p>
      </footer>
    </div>
  )
}