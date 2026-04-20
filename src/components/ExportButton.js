import { useState, useRef, useEffect } from 'react'

export default function ExportButton({
  onExportCSV,
  onExportExcel,
  onExportPDF,
  filename,
  rowCount = 0,
  disabled = false,
  showCSV = true,
  showExcel = true,
  showPDF = false,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleExport(format) {
    if (rowCount > 500) {
      const confirmed = window.confirm(
        `You are about to export ${rowCount} rows. Continue?`
      )
      if (!confirmed) return
    }

    setIsOpen(false)

    switch (format) {
      case 'csv':
        onExportCSV?.()
        break
      case 'excel':
        onExportExcel?.()
        break
      case 'pdf':
        onExportPDF?.()
        break
      default:
        break
    }
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
          disabled
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-200'
        }`}
        title="Export data"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span className="hidden sm:inline text-sm">Export</span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border z-50">
          <div className="py-1">
            {showCSV && (
              <button
                onClick={() => handleExport('csv')}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="w-8 text-gray-400">📄</span>
                CSV
              </button>
            )}
            {showExcel && (
              <button
                onClick={() => handleExport('excel')}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="w-8 text-gray-400">📊</span>
                Excel (.xlsx)
              </button>
            )}
            {showPDF && (
              <button
                onClick={() => handleExport('pdf')}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="w-8 text-gray-400">📕</span>
                PDF
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Simple export icon button (no dropdown)
export function ExportIconButton({ onClick, disabled = false, title = 'Export' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-lg border transition-colors ${
        disabled
          ? 'text-gray-400 cursor-not-allowed'
          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
      }`}
      title={title}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </button>
  )
}