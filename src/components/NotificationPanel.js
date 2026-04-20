import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TYPE_CONFIG = {
  invoice_overdue: { color: 'red', icon: '⚠️' },
  payment_failed: { color: 'red', icon: '❌' },
  route_not_started: { color: 'amber', icon: '⏰' },
  payment_received: { color: 'green', icon: '✅' },
  mandate_activated: { color: 'green', icon: '🔗' },
  mandate_cancelled: { color: 'red', icon: '❌' },
  route_completed: { color: 'blue', icon: '🗺️' },
  recurring_invoice_generated: { color: 'blue', icon: '📄' },
}

export default function NotificationPanel({ isOpen, onClose, user }) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState('all') // all | unread
  const panelRef = useRef(null)

  const isWorker = user?.role === 'worker'
  const workerId = user?.role === 'worker' ? user?.id : null

  useEffect(() => {
    if (isOpen) {
      loadNotifications()
      loadUnreadCount()
      subscribeToNotifications()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user])

  async function loadNotifications() {
    setLoading(true)
    let query = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (isWorker) {
      query = query.eq('user_id', workerId)
    }

    const { data } = await query
    setNotifications(data || [])
    setLoading(false)
  }

  async function loadUnreadCount() {
    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)

    if (isWorker) {
      query = query.eq('user_id', workerId)
    }

    const { count } = await query
    setUnreadCount(count || 0)
  }

  async function subscribeToNotifications() {
    const channel = supabase
      .channel('notifications-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: isWorker ? `user_id=eq.${workerId}` : 'user_id=is.null'
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev])
        setUnreadCount(prev => prev + 1)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  const handleMarkAsRead = async (notification) => {
    if (!notification.is_read) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification.id)

      setNotifications(prev =>
        prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    }
  }

  const handleMarkAllRead = async () => {
    await supabase.rpc('mark_all_notifications_read', { p_user_id: isWorker ? workerId : null })
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  const handleNotificationClick = (notification) => {
    handleMarkAsRead(notification)
    if (notification.action_url) {
      navigate(notification.action_url)
      onClose()
    }
  }

  const formatTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 172800) return 'Yesterday'
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const filteredNotifications = filter === 'unread'
    ? notifications.filter(n => !n.is_read)
    : notifications

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      
      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 w-full sm:w-[380px] bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-4">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 text-sm border-b-2 ${
              filter === 'all' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-4 py-2 text-sm border-b-2 ${
              filter === 'unread' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
            }`}
          >
            Unread ({unreadCount})
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="ml-auto text-sm text-blue-600 hover:text-blue-700"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <span className="text-4xl mb-2">✓</span>
              <p>You're all caught up</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredNotifications.map(notification => {
                const config = TYPE_CONFIG[notification.type] || { color: 'gray', icon: '📌' }
                const borderColors = {
                  red: 'border-l-red-500',
                  green: 'border-l-green-500',
                  blue: 'border-l-blue-500',
                  amber: 'border-l-amber-500',
                  gray: 'border-l-gray-300',
                }

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left p-4 border-l-4 hover:bg-gray-50 transition ${
                      borderColors[config.color]
                    } ${notification.is_read ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{config.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${!notification.is_read ? 'font-semibold' : ''}`}>
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-2 mt-0.5">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatTimeAgo(notification.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Export unread count getter for header use
export function useNotificationCount(user) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    async function fetchCount() {
      if (!user) return
      
      const workerId = user.role === 'worker' ? user.id : null
      const query = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false)

      if (user.role === 'worker') {
        query.eq('user_id', workerId)
      }

      const { count } = await query
      setCount(count || 0)
    }

    fetchCount()
  }, [user])

  return count
}