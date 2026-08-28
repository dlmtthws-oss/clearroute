import { useState, useEffect, useRef, useCallback } from 'react'
import { useJarvisBrain } from '../lib/useJarvisBrain'

// Device glyphs for the presence bar.
const DEVICE_ICON = {
  phone: 'M11 4h2m-6 16h8a1 1 0 001-1V5a1 1 0 00-1-1H7a1 1 0 00-1 1v14a1 1 0 001 1z',
  tablet: 'M9 4h6m-9 16h12a1 1 0 001-1V5a1 1 0 00-1-1H6a1 1 0 00-1 1v14a1 1 0 001 1z',
  computer:
    'M9 17v2m6-2v2M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z',
}

function deviceIconFor(type) {
  return DEVICE_ICON[type] || DEVICE_ICON.computer
}

// Strip markdown/currency markup so speech synthesis reads naturally.
function toSpeech(text) {
  return (text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\n+/g, '. ')
    .trim()
}

function renderMessage(content) {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/£([\d,]+(?:\.\d{2})?)/g, '<span class="jv-money">£$1</span>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
}

export default function Jarvis({ user }) {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceOut, setVoiceOut] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const {
    device,
    devices,
    messages,
    thinking,
    remoteStatus,
    ready,
    sendMessage,
    startNewBrainThread,
    broadcastStatus,
  } = useJarvisBrain(user)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const spokenRef = useRef(new Set())

  const isWorker = user?.role === 'worker'
  const voiceInputSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  const voiceOutSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  // --- launcher shortcut: Cmd/Ctrl+Shift+J (and legacy +A) ---
  useEffect(() => {
    const onKey = (e) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'J' || e.key === 'j' || e.key === 'A' || e.key === 'a')
      ) {
        e.preventDefault()
        if (!isWorker) setIsOpen((v) => !v)
      }
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isWorker])

  useEffect(() => {
    if (messages.length) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  // Speak new assistant replies aloud when voice output is on.
  useEffect(() => {
    if (!voiceOut || !voiceOutSupported) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const key = last.id || last.content
    if (spokenRef.current.has(key)) return
    spokenRef.current.add(key)
    try {
      const u = new SpeechSynthesisUtterance(toSpeech(last.content))
      u.rate = 1.02
      u.pitch = 0.95
      u.onstart = () => setSpeaking(true)
      u.onend = () => setSpeaking(false)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch {
      /* ignore */
    }
  }, [messages, voiceOut, voiceOutSupported])

  const stopSpeaking = useCallback(() => {
    if (voiceOutSupported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [voiceOutSupported])

  const submit = useCallback(
    (text) => {
      const value = (text ?? input).trim()
      if (!value) return
      setInput('')
      stopSpeaking()
      sendMessage(value)
    },
    [input, sendMessage, stopSpeaking]
  )

  // --- voice input via Web Speech API ---
  const toggleListen = useCallback(() => {
    if (!voiceInputSupported) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'en-GB'
    rec.interimResults = true
    rec.continuous = false
    let finalText = ''
    rec.onstart = () => {
      setListening(true)
      broadcastStatus('listening')
    }
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t
        else interim += t
      }
      setInput((finalText + interim).trim())
    }
    rec.onerror = () => {
      setListening(false)
      broadcastStatus(null)
    }
    rec.onend = () => {
      setListening(false)
      broadcastStatus(null)
      const value = finalText.trim()
      if (value) submit(value)
    }
    recognitionRef.current = rec
    stopSpeaking()
    rec.start()
  }, [voiceInputSupported, listening, submit, broadcastStatus, stopSpeaking])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        /* ignore */
      }
      if (voiceOutSupported) window.speechSynthesis.cancel()
    }
  }, [voiceOutSupported])

  if (isWorker) return null

  const orbState = listening
    ? 'listening'
    : thinking || remoteStatus?.status === 'thinking'
    ? 'thinking'
    : speaking
    ? 'speaking'
    : 'idle'

  const otherDevices = devices.filter((d) => d.deviceId !== device.id)
  const suggestions = [
    'Who owes me the most money?',
    'Revenue this month vs last?',
    'Which routes ran over time this week?',
    'Who is my best performing worker?',
  ]

  const statusLine = remoteStatus?.status
    ? `${remoteStatus.device || 'Another device'} is ${remoteStatus.status}…`
    : otherDevices.length
    ? `Synced across ${devices.length} device${devices.length > 1 ? 's' : ''}`
    : 'One brain, ready'

  return (
    <>
      {/* Launcher orb */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open Jarvis assistant"
        className="jv-launcher"
      >
        <span className="jv-launcher-core" />
        <span className="jv-launcher-ring" />
        {otherDevices.length > 0 && (
          <span className="jv-launcher-badge">{devices.length}</span>
        )}
      </button>

      {isOpen && (
        <div className="jv-overlay" onClick={() => setIsOpen(false)}>
          <div className="jv-panel" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="jv-header">
              <div className="jv-brand">
                <div className={`jv-orb jv-orb-${orbState}`}>
                  <span className="jv-orb-inner" />
                </div>
                <div>
                  <div className="jv-title">JARVIS</div>
                  <div className="jv-subtitle">{statusLine}</div>
                </div>
              </div>
              <div className="jv-header-actions">
                {voiceOutSupported && (
                  <button
                    className={`jv-icon-btn ${voiceOut ? 'jv-active' : ''}`}
                    onClick={() => {
                      setVoiceOut((v) => !v)
                      stopSpeaking()
                    }}
                    title={voiceOut ? 'Voice replies on' : 'Voice replies off'}
                    aria-label="Toggle voice replies"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {voiceOut ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5 9v6h4l5 4V5L9 9H5z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 9v6h4l5 4V5L9 9H5zM17 9l4 4m0-4l-4 4" />
                      )}
                    </svg>
                  </button>
                )}
                <button
                  className="jv-icon-btn"
                  onClick={startNewBrainThread}
                  title="New thread"
                  aria-label="Start new thread"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  className="jv-icon-btn"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Device presence bar */}
            <div className="jv-devices">
              {devices.length === 0 && (
                <span className="jv-device jv-device-self">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path strokeLinecap="round" strokeLinejoin="round" d={deviceIconFor(device.type)} />
                  </svg>
                  {device.label} · you
                </span>
              )}
              {devices.map((d) => (
                <span
                  key={d.deviceId}
                  className={`jv-device ${d.deviceId === device.id ? 'jv-device-self' : ''}`}
                >
                  <span className="jv-dot" />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path strokeLinecap="round" strokeLinejoin="round" d={deviceIconFor(d.type)} />
                  </svg>
                  {d.label}
                  {d.deviceId === device.id ? ' · you' : ''}
                </span>
              ))}
            </div>

            {/* Messages */}
            <div className="jv-messages">
              {ready && messages.length === 0 ? (
                <div className="jv-empty">
                  <div className={`jv-orb jv-orb-idle jv-orb-lg`}>
                    <span className="jv-orb-inner" />
                  </div>
                  <h4>Good {greeting()}. How can I help?</h4>
                  <p>
                    One assistant, shared live across your devices. Ask on your
                    laptop, pick it up on your desktop.
                  </p>
                  <div className="jv-suggestions">
                    {suggestions.map((s, i) => (
                      <button key={i} className="jv-suggestion" onClick={() => submit(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m, i) => (
                    <div
                      key={m.id || i}
                      className={`jv-msg ${m.role === 'user' ? 'jv-msg-user' : 'jv-msg-ai'}`}
                    >
                      {m.role === 'assistant' ? (
                        <div
                          className="jv-bubble"
                          dangerouslySetInnerHTML={{ __html: renderMessage(m.content) }}
                        />
                      ) : (
                        <div className="jv-bubble">{m.content}</div>
                      )}
                    </div>
                  ))}
                  {(thinking || remoteStatus?.status === 'thinking') && (
                    <div className="jv-msg jv-msg-ai">
                      <div className="jv-bubble jv-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Composer */}
            <div className="jv-composer">
              {voiceInputSupported && (
                <button
                  className={`jv-mic ${listening ? 'jv-mic-live' : ''}`}
                  onClick={toggleListen}
                  aria-label={listening ? 'Stop listening' : 'Speak to Jarvis'}
                  title={listening ? 'Listening…' : 'Speak'}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4" />
                  </svg>
                </button>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={listening ? 'Listening…' : 'Ask Jarvis anything…'}
                className="jv-input"
              />
              <button
                className="jv-send"
                onClick={() => submit()}
                disabled={!input.trim()}
                aria-label="Send"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}
