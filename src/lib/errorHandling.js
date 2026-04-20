import * as Sentry from '@sentry/react';

const TOAST_DURATION = {
  success: 4000,
  error: 8000,
  warning: 8000,
  info: 4000,
};

let toastId = 0;
const toasts = [];

function createToastElement(toast) {
  const el = document.createElement('div');
  el.id = `toast-${toast.id}`;
  el.className = `
    fixed top-4 right-4 z-50 max-w-sm p-4 rounded-lg shadow-lg
    transform transition-all duration-300 ease-in-out
    flex items-start gap-3
  `;
  
  const colors = {
    success: 'bg-green-50 border border-green-200 text-green-800',
    error: 'bg-red-50 border border-red-200 text-red-800',
    warning: 'bg-amber-50 border border-amber-200 text-amber-800',
    info: 'bg-blue-50 border border-blue-200 text-blue-800',
  };
  
  const icons = {
    success: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>',
    error: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>',
    warning: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>',
    info: '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
  };
  
  el.innerHTML = `
    <div class="${colors[toast.type]} ${toast.type === 'success' ? 'text-green-600' : toast.type === 'error' ? 'text-red-600' : toast.type === 'warning' ? 'text-amber-600' : 'text-blue-600'}">
      ${icons[toast.type]}
    </div>
    <div class="flex-1">
      <p class="text-sm font-medium">${toast.title}</p>
      ${toast.message ? `<p class="text-sm mt-1 opacity-80">${toast.message}</p>` : ''}
    </div>
    <button class="opacity-60 hover:opacity-100 transition-opacity">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  `;
  
  el.querySelector('button').addEventListener('click', () => removeToast(toast.id));
  
  return el;
}

function removeToast(id) {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx > -1) {
    toasts.splice(idx, 1);
    const el = document.getElementById(`toast-${id}`);
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateX(100%)';
      setTimeout(() => el.remove(), 300);
    }
  }
}

export function showToast(type, title, message = null) {
  if (toasts.length >= 3) {
    const oldest = toasts.shift();
    const el = document.getElementById(`toast-${oldest.id}`);
    if (el) el.remove();
  }
  
  const toast = { id: ++toastId, type, title, message };
  toasts.push(toast);
  
  const el = createToastElement(toast);
  document.body.appendChild(el);
  
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });
  
  setTimeout(() => removeToast(toast.id), TOAST_DURATION[type]);
  
  return toast.id;
}

export function showSuccessToast(title, message = null) {
  return showToast('success', title, message);
}

export function showErrorToast(title, message = null) {
  return showToast('error', title, message);
}

export function showWarningToast(title, message = null) {
  return showToast('warning', title, message);
}

export function showInfoToast(title, message = null) {
  return showToast('info', title, message);
}

const ERROR_MESSAGES = {
  PGRST116: 'This record no longer exists',
  23505: 'This already exists',
  42501: "You don't have permission to do this",
  'NETWORK_ERROR': 'Could not connect to server. Please check your connection.',
  'TIMEOUT': 'Request timed out. Please try again.',
  'DEFAULT': 'Something went wrong. Please try again.',
};

export function handleSupabaseError(error, customMessage = null) {
  let message = customMessage || ERROR_MESSAGES.DEFAULT;
  let code = null;
  
  if (!error) {
    return showErrorToast('Error', message);
  }
  
  if (error.code) {
    code = error.code;
    const errorCode = String(error.code);
    
    if (ERROR_MESSAGES[errorCode]) {
      message = ERROR_MESSAGES[errorCode];
    } else if (error.message) {
      if (error.message.includes('network') || error.message.includes('fetch')) {
        message = ERROR_MESSAGES.NETWORK_ERROR;
      } else if (error.message.includes('timeout')) {
        message = ERROR_MESSAGES.TIMEOUT;
      }
    }
  } else if (error.message) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      message = ERROR_MESSAGES.NETWORK_ERROR;
    }
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.error('Supabase error:', { error, code, message });
  }
  
  if (process.env.NODE_ENV === 'production' && process.env.VITE_SENTRY_DSN) {
    Sentry.captureException(error, {
      extra: { code, originalMessage: error.message },
    });
  }
  
  return showErrorToast(customMessage || 'Error', message);
}

const errorHandlers = { showToast, showSuccessToast, showErrorToast, showWarningToast, showInfoToast, handleSupabaseError };
export default errorHandlers;