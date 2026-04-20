import { useNetworkStatus } from '../lib/useNetworkStatus';

export default function OfflineBanner() {
  const { isOnline, wasOffline } = useNetworkStatus();
  
  if (isOnline && !wasOffline) return null;
  
  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 transition-all duration-300 ${
      isOnline 
        ? 'bg-green-500 text-white' 
        : 'bg-amber-500 text-white'
    }`}>
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        {isOnline ? (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Back online</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.69 4.69a11 11 0 01-15.536-15.536 11 11 0 0115.536 15.536" />
            </svg>
            <span>You are offline — changes will not be saved until your connection is restored</span>
          </>
        )}
      </div>
    </div>
  );
}