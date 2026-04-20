import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function AIAssistant({ user }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [conversations, setConversations] = useState([])
  const [currentPage, setCurrentPage] = useState('/')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const isWorker = user?.role === 'worker'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (isOpen && !isWorker) {
      loadConversations()
      setCurrentPage(window.location.pathname)
    }
  }, [isOpen, isWorker])

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom()
    }
  }, [messages])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        if (!isWorker) setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isWorker])

  async function loadConversations() {
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('user_id', user?.id)
      .order('updated_at', { ascending: false })
      .limit(20)
    setConversations(data || [])
  }

  async function loadConversation(id) {
    const { data } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    setMessages(data || [])
    setConversationId(id)
  }

  async function sendMessage() {
    if (!input.trim() || loading) return
    
    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', content: userMessage, created_at: new Date().toISOString() }])

    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          message: userMessage,
          conversationId,
          userId: user?.id,
          context: { currentPage }
        }
      })

      if (error) throw error

      if (data?.conversationId && !conversationId) {
        setConversationId(data.conversationId)
        loadConversations()
      }

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: data?.response || 'Sorry, I could not process that request.',
        created_at: new Date().toISOString()
      }])
    } catch (err) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'I encountered an error. Please try again.',
        created_at: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  async function startNewConversation() {
    setConversationId(null)
    setMessages([])
  }

  const suggestedPrompts = [
    "Who owes me the most money?",
    "What was my revenue this month?",
    "Which routes ran over time this week?",
    "Who's my best performing worker?"
  ]

  const formatMessage = (content) => {
    return content
      .replace(/£([\d,]+(?:\.\d{2})?)/g, '<span class="font-semibold text-blue-600">£$1</span>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
      .replace(/^(\d+\..*)$/gm, '<li class="ml-4">$1</li>')
  }

  if (isWorker) return null

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-full shadow-lg flex items-center gap-2 z-50 transition-all hover:scale-105"
        style={{ boxShadow: '0 4px 20px rgba(37, 99, 235, 0.4)' }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3 3 0 0013 12h-1m-1 7v3m0-3h.01" />
        </svg>
        <span className="font-medium hidden md:inline">Ask AI</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setIsOpen(false)}>
          <div 
            className="w-full md:w-[400px] bg-white h-full shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between bg-blue-600 text-white">
              <div>
                <h3 className="font-semibold">ClearRoute Assistant</h3>
                <p className="text-xs text-blue-100">Powered by Claude</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-blue-700 rounded">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="text-center py-8">
                    <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3 3 0 0013 12h-1m-1 7v3m0-3h.01" />
                      </svg>
                    </div>
                    <h4 className="font-semibold text-gray-800">Ask anything about your business</h4>
                    <p className="text-sm text-gray-500 mt-1">I can help with questions about customers, invoices, routes, and more.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {suggestedPrompts.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setInput(prompt)
                          setTimeout(() => sendMessage(), 100)
                        }}
                        className="text-xs p-2 text-left bg-gray-50 hover:bg-gray-100 rounded text-gray-600 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-3 rounded-lg ${
                        msg.role === 'user' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-white border shadow-sm text-gray-800'
                      }`}>
                        {msg.role === 'user' ? msg.content : (
                          <div 
                            className="prose prose-sm"
                            dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-white border shadow-sm p-3 rounded-lg flex items-center gap-1">
                        <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <div className="p-4 border-t">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder="Ask anything about your business..."
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={loading}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}