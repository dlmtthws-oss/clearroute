import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function CommunicationsCentre({ user }) {
  const [communications, setCommunications] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  const [selectedComm, setSelectedComm] = useState(null)
  const [sending, setSending] = useState(false)

  const isWorker = user?.role === 'worker'
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!isWorker) {
      loadCommunications()
    }
  }, [isWorker, tab])

  async function loadCommunications() {
    setLoading(true)
    let query = supabase
      .from('communication_queue')
      .select('*, customers(name, email, phone)')
      .order('created_at', { ascending: false })
      .limit(50)

    if (tab === 'pending') {
      query = query.eq('status', 'ready')
    } else if (tab === 'sent') {
      query = query.eq('status', 'sent')
    } else if (tab === 'scheduled') {
      query = query.eq('status', 'approved').not('scheduled_send_at', 'is', null)
    }

    const { data } = await query
    if (data) {
      setCommunications(data.map(c => ({
        ...c,
        customerName: c.customers?.name,
        customerEmail: c.customers?.email,
        customerPhone: c.customers?.phone
      })))
    }
    setLoading(false)
  }

  async function approveAndSend(commId) {
    setSending(true)
    const { data: settings } = await supabase
      .from('company_settings')
      .select('email_from_address')
      .eq('profiles_id', user?.id)
      .single()

    await supabase.from('communication_queue').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      approved_by: user?.id,
      approved_at: new Date().toISOString()
    }).eq('id', commId)

    await supabase.from('email_log').insert({
      user_id: user?.id,
      customer_id: communications.find(c => c.id === commId)?.customer_id,
      subject: communications.find(c => c.id === commId)?.generated_subject || 'AI Generated',
      recipient_email: communications.find(c => c.id === commId)?.customerEmail,
      status: 'sent'
    })

    loadCommunications()
    setSending(false)
    setSelectedComm(null)
  }

  async function cancelCommunication(commId) {
    await supabase.from('communication_queue').update({
      status: 'cancelled'
    }).eq('id', commId)
    loadCommunications()
  }

  const getTypeBadge = (type) => {
    const styles = {
      appointment_confirmation: 'bg-blue-100 text-blue-700',
      payment_reminder_soft: 'bg-amber-100 text-amber-700',
      payment_reminder_firm: 'bg-red-100 text-red-700',
      job_completion: 'bg-green-100 text-green-700',
      satisfaction_follow_up: 'bg-purple-100 text-purple-700',
      re_engagement: 'bg-pink-100 text-pink-700'
    }
    return styles[type] || 'bg-gray-100 text-gray-700'
  }

  const getStatusBadge = (status) => {
    const styles = {
      ready: 'bg-amber-100 text-amber-700',
      approved: 'bg-blue-100 text-blue-700',
      sent: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-700'
    }
    return styles[status] || 'bg-gray-100 text-gray-700'
  }

  if (isWorker) {
    return <div className="p-6 text-center text-gray-500">Communications centre is not available for field workers.</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Communications</h1>
        <p className="text-gray-500">AI-powered automated messages</p>
      </div>

      <div className="flex gap-2 border-b">
        {['pending', 'scheduled', 'sent'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 font-medium capitalize ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {t === 'pending' ? 'Needs Approval' : t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Customer</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Channel</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Preview</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center">Loading...</td></tr>
            ) : communications.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No communications</td></tr>
            ) : communications.map(comm => (
              <tr key={comm.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeBadge(comm.communication_type)}`}>
                    {comm.communication_type.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium">{comm.customerName}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 rounded text-xs bg-gray-100">
                    {comm.channel?.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(comm.status)}`}>
                    {comm.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 text-sm truncate max-w-xs">
                  {comm.generated_subject || comm.generated_body?.slice(0, 50)}
                </td>
                <td className="px-4 py-3">
                  {comm.status === 'ready' && isAdmin ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedComm(comm)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Review
                      </button>
                      <button
                        onClick={() => cancelCommunication(comm.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : comm.status === 'sent' ? (
                    <button className="text-gray-600 hover:text-gray-800 text-sm">
                      View
                    </button>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedComm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedComm(null)}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Review Communication</h3>
              <button onClick={() => setSelectedComm(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Subject</label>
                <div className="p-3 bg-gray-50 rounded">{selectedComm.generated_subject || '(No subject)'}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Message</label>
                <div className="p-3 bg-gray-50 rounded whitespace-pre-wrap">{selectedComm.generated_body}</div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => approveAndSend(selectedComm.id)}
                  disabled={sending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Approve & Send'}
                </button>
                <button
                  onClick={() => setSelectedComm(null)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}