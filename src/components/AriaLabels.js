export const buttonStates = {
  default: 'bg-gray-900 text-white rounded-md hover:bg-gray-800',
  loading: 'bg-gray-400 text-white rounded-md cursor-not-allowed opacity-50',
  disabled: 'bg-gray-200 text-gray-500 rounded-md cursor-not-allowed',
  success: 'bg-green-600 text-white rounded-md hover:bg-green-700',
  danger: 'bg-red-600 text-white rounded-md hover:bg-red-700',
};

export function AriaButton({
  children,
  loading,
  disabled,
  variant = 'default',
  ariaLabel,
  ...props
}) {
  const state = loading ? 'loading' : disabled ? 'disabled' : variant;
  return (
    <button
      aria-busy={loading}
      aria-disabled={disabled || loading}
      aria-label={ariaLabel}
      disabled={disabled || loading}
      className={`px-4 py-2 transition-colors ${buttonStates[state]} ${props.className || ''}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export function AriaInput({
  label,
  id,
  error,
  required,
  ...props
}) {
  const inputId = id || props.name;
  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-required={required}
        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 ${
          error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
        } ${props.className || ''}`}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AriaSelect({
  label,
  id,
  error,
  required,
  options = [],
  placeholder,
  ...props
}) {
  const inputId = id || props.name;
  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-required={required}
        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 ${
          error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
        } ${props.className || ''}`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) =>
          typeof opt === 'object' ? (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ) : (
            <option key={opt} value={opt}>
              {opt}
            </option>
          )
        )}
      </select>
      {error && (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-gray-900 focus:text-white focus:rounded-md"
    >
      Skip to main content
    </a>
  );
}

export function LiveRegion({ message, announce = 'polite' }) {
  return (
    <div role="status" aria-live={announce} aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}