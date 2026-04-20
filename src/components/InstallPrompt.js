import { useState, useEffect } from 'react'

const INSTALL_PROMPT_KEY = 'clearroute_install_prompt_dismissed'
const VISIT_COUNT_KEY = 'clearroute_visit_count'

export default function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isIOS, setIsIOS] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    setIsInstalled(isStandalone)

    // Check iOS
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIOS(iOS)

    // Track visits
    const visitCount = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10)
    localStorage.setItem(VISIT_COUNT_KEY, String(visitCount + 1))

    // Check if previously dismissed
    const dismissed = localStorage.getItem(INSTALL_PROMPT_KEY)
    const dismissedDate = dismissed ? new Date(dismissed) : null
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    if (dismissedDate && dismissedDate > sevenDaysAgo) {
      return // Still within dismissal period
    }

    // Show prompt after 3 visits if not installed
    if (visitCount >= 3 && !isStandalone) {
      setShowPrompt(true)
    }

    // Listen for beforeinstallprompt
    const handleBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      if (!isStandalone && !dismissedDate) {
        setShowPrompt(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  const handleDismiss = () => {
    setShowPrompt(false)
    localStorage.setItem(INSTALL_PROMPT_KEY, new Date().toISOString())
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return

    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      setShowPrompt(false)
      setIsInstalled(true)
    }
    setDeferredPrompt(null)
  }

  if (!showPrompt || isInstalled) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 z-50">
      <div className="bg-gray-900 text-white rounded-xl p-4 shadow-2xl max-w-md mx-auto">
        {isIOS ? (
          // iOS instructions
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium mb-2">Add ClearRoute to your Home Screen</p>
              <p className="text-sm text-gray-300 mb-3">
                Tap the <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-700 rounded text-xs">↗</span> button in Safari's toolbar, then "Add to Home Screen"
              </p>
              <button
                onClick={handleDismiss}
                className="text-sm text-gray-400 hover:text-white"
              >
                Not now
              </button>
            </div>
          </div>
        ) : (
          // Android/Desktop install prompt
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium mb-1">Add ClearRoute to your home screen</p>
              <p className="text-sm text-gray-300 mb-2">for quick access</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleInstall}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Install
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-2 text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}