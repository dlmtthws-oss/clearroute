import { useState, useCallback } from 'react';

export default function NetworkErrorHandler({ children, onRetry }) {
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    setError(null);
    setRetrying(true);
    try {
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      setError(err);
    } finally {
      setRetrying(false);
    }
  }, [onRetry]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-3 bg-red-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-red-900 mb-1">Connection Error</h3>
        <p className="text-sm text-red-700 mb-4">
          We couldn't connect to the server. Please check your internet connection and try again.
        </p>
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {retrying ? 'Retrying...' : 'Try Again'}
        </button>
      </div>
    );
  }

  return children;
}

export function useNetworkError() {
  const [networkError, setNetworkError] = useState(null);

  const handleError = useCallback((err) => {
    if (err.message?.includes('network') || err.message?.includes('fetch')) {
      setNetworkError('Network error. Please check your connection.');
    } else {
      throw err;
    }
  }, []);

  const clearError = useCallback(() => {
    setNetworkError(null);
  }, []);

  return { networkError, handleError, clearError };
}