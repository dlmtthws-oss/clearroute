import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// --- Device identity -------------------------------------------------------
// A stable per-browser id + a friendly label so the "one brain" can show
// which devices are currently connected (laptop <-> desktop <-> phone).

function detectDeviceType() {
  const ua = navigator.userAgent || ''
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet'
  if (/Mobi|iPhone|Android.*Mobile|Windows Phone/i.test(ua)) return 'phone'
  return 'computer'
}

function detectDeviceLabel(type) {
  if (type === 'phone') return 'Phone'
  if (type === 'tablet') return 'Tablet'
  // Best-effort laptop vs desktop split for the "laptop and computer" split.
  // Resolved async via the Battery API where available; default to "Computer".
  return 'Computer'
}

function getDeviceIdentity() {
  let id
  try {
    id = localStorage.getItem('jarvis_device_id')
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('jarvis_device_id', id)
    }
  } catch {
    id = 'dev_' + Math.random().toString(36).slice(2)
  }
  const type = detectDeviceType()
  return { id, type, label: detectDeviceLabel(type) }
}

// Refine "Computer" into "Laptop" / "Desktop" using the Battery API.
async function refineComputerLabel(type) {
  if (type !== 'computer') return null
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery()
      // A machine that reports a real battery level and can run unplugged
      // is almost certainly a laptop; a desktop typically reports charging
      // with level pinned at 1 and no meaningful discharge time.
      const hasBattery = typeof b.level === 'number' && b.dischargingTime !== 0 && b.dischargingTime !== Infinity
      return hasBattery || !b.charging ? 'Laptop' : 'Desktop'
    }
  } catch {
    /* ignore */
  }
  return null
}

// --- Message reconciliation ------------------------------------------------
// Optimistic messages carry a temp id; persisted realtime rows carry a real
// uuid. Merge so each turn appears exactly once regardless of which arrives
// first (local echo, edge-function response, or realtime from another device).

function mergeMessage(list, incoming) {
  if (incoming.id && list.some((m) => m.id === incoming.id)) {
    return list // already have the persisted row
  }
  const idx = list.findIndex(
    (m) =>
      m.temp &&
      m.role === incoming.role &&
      m.content.trim() === (incoming.content || '').trim()
  )
  if (idx !== -1) {
    const next = list.slice()
    next[idx] = { ...incoming, temp: false }
    return next
  }
  return [...list, { ...incoming, temp: incoming.temp || false }]
}

/**
 * useJarvisBrain — a single conversation ("brain") shared live across every
 * device the user is signed into.
 */
export function useJarvisBrain(user) {
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [devices, setDevices] = useState([])
  const [remoteStatus, setRemoteStatus] = useState(null) // { device, status } from another device
  const [thinking, setThinking] = useState(false)
  const [ready, setReady] = useState(false)

  const deviceRef = useRef(getDeviceIdentity())
  const roomRef = useRef(null)
  const conversationIdRef = useRef(null)
  const userId = user?.id

  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // Refine laptop/desktop label once.
  useEffect(() => {
    let active = true
    refineComputerLabel(deviceRef.current.type).then((label) => {
      if (active && label) deviceRef.current.label = label
    })
    return () => {
      active = false
    }
  }, [])

  // Resolve the shared active conversation: the user's most recently updated
  // thread. All devices converge on the same one -> one brain.
  const loadActiveConversation = useCallback(async () => {
    if (!userId) return
    const { data: convs } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
    const activeId = convs?.[0]?.id || null
    if (activeId) {
      setConversationId(activeId)
      const { data: msgs } = await supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: true })
      setMessages(msgs || [])
    } else {
      setConversationId(null)
      setMessages([])
    }
    setReady(true)
  }, [userId])

  useEffect(() => {
    loadActiveConversation()
  }, [loadActiveConversation])

  // Follow the active conversation's live message stream. Re-subscribes when
  // the shared conversation changes.
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`jarvis-msgs-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => mergeMessage(prev, payload.new))
          if (payload.new.role === 'assistant') setThinking(false)
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  // Watch for the shared active thread changing on another device (a new
  // conversation started, or an older one bumped to the top).
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`jarvis-convs-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_conversations',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new
          if (!row?.id) return
          // Adopt a newly created conversation from any device as the brain.
          if (payload.eventType === 'INSERT' && row.id !== conversationIdRef.current) {
            setConversationId(row.id)
            setMessages([])
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  // Presence + status broadcast room: shows connected devices and relays a
  // live "listening / thinking" state between them.
  useEffect(() => {
    if (!userId) return
    const me = deviceRef.current
    const room = supabase.channel(`jarvis-room-${userId}`, {
      config: { presence: { key: me.id } },
    })
    roomRef.current = room

    room
      .on('presence', { event: 'sync' }, () => {
        const state = room.presenceState()
        const list = Object.values(state)
          .map((entries) => entries[0])
          .filter(Boolean)
        setDevices(list)
      })
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        if (payload?.deviceId === me.id) return
        setRemoteStatus(payload?.status ? payload : null)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await room.track({
            deviceId: me.id,
            type: me.type,
            label: me.label,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      supabase.removeChannel(room)
      roomRef.current = null
    }
  }, [userId])

  // Broadcast this device's activity so siblings can show "Jarvis is
  // listening on your Laptop", etc.
  const broadcastStatus = useCallback((status) => {
    const room = roomRef.current
    if (!room) return
    const me = deviceRef.current
    room.send({
      type: 'broadcast',
      event: 'status',
      payload: { deviceId: me.id, device: me.label, status },
    })
  }, [])

  const sendMessage = useCallback(
    async (text, context = {}) => {
      const content = (text || '').trim()
      if (!content || !userId) return
      // Optimistic local echo.
      setMessages((prev) =>
        mergeMessage(prev, {
          id: 'temp_' + Date.now(),
          role: 'user',
          content,
          created_at: new Date().toISOString(),
          temp: true,
        })
      )
      setThinking(true)
      broadcastStatus('thinking')

      try {
        const { data, error } = await supabase.functions.invoke('ai-assistant', {
          body: {
            message: content,
            conversationId: conversationIdRef.current,
            userId,
            context: { currentPage: window.location.pathname, ...context },
          },
        })
        if (error) throw error

        if (data?.conversationId && data.conversationId !== conversationIdRef.current) {
          setConversationId(data.conversationId)
        }
        // Reconcile the reply immediately (realtime will dedupe the same row).
        if (data?.response) {
          setMessages((prev) =>
            mergeMessage(prev, {
              id: 'temp_reply_' + Date.now(),
              role: 'assistant',
              content: data.response,
              created_at: new Date().toISOString(),
              temp: true,
            })
          )
        }
        return data // includes proposedActions for the UI to confirm
      } catch (err) {
        setMessages((prev) =>
          mergeMessage(prev, {
            id: 'temp_err_' + Date.now(),
            role: 'assistant',
            content: 'I hit a problem reaching the network. Please try again.',
            created_at: new Date().toISOString(),
            temp: true,
          })
        )
      } finally {
        setThinking(false)
        broadcastStatus(null)
      }
    },
    [userId, broadcastStatus]
  )

  // Execute a confirmed action by calling the jarvis-dispatch edge function,
  // which signs and forwards it to the self-hosted n8n webhook.
  const dispatchAction = useCallback(async (automationId, params = {}) => {
    const { data, error } = await supabase.functions.invoke('jarvis-dispatch', {
      body: { automationId, params },
    })
    if (error) throw error
    return data
  }, [])

  const startNewBrainThread = useCallback(() => {
    // Next message creates a fresh conversation that all devices will adopt.
    setConversationId(null)
    setMessages([])
  }, [])

  return {
    device: deviceRef.current,
    devices,
    messages,
    thinking,
    remoteStatus,
    ready,
    conversationId,
    sendMessage,
    dispatchAction,
    startNewBrainThread,
    broadcastStatus,
  }
}
