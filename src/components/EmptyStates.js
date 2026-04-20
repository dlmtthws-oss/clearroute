import { Link } from 'react-router-dom';

const icons = {
  person: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM12 14v3m-4-3v3m-4-3v3M3 17v-2a4 4 0 014-4h6a4 4 0 014 4v2m-4-5a4 4 0 00-4-4H7" />',
  document: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />',
  map: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />',
  receipt: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />',
  quote: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.167 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />',
  bell: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />',
  clock: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />',
  calendar: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />',
  check: '<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />',
};

function EmptyState({ icon, heading, message, actions }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icons[icon] || icons.person}
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{heading}</h3>
      <p className="text-gray-500 mb-6 max-w-md">{message}</p>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  );
}

export function EmptyStateCustomers({ hasCustomers = false, onClearFilters }) {
  if (hasCustomers) {
    return (
      <EmptyState
        icon="person"
        heading="No customers found"
        message="Try a different search term or clear your filters."
        actions={
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Clear Filters
          </button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon="person"
      heading="No customers yet"
      message="Add your first customer to get started, or import all your existing customers at once."
      actions={
        <>
          <Link
            to="/customers?new=true"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Customer
          </Link>
          <Link
            to="/customers/import"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Import Customers
          </Link>
        </>
      }
    />
  );
}

export function EmptyStateInvoices({ hasInvoices = false, onClearFilters }) {
  if (hasInvoices) {
    return (
      <EmptyState
        icon="document"
        heading="No invoices match your filters"
        message="Try adjusting your filters to see different results."
        actions={
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Clear Filters
          </button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon="document"
      heading="No invoices yet"
      message="Create your first invoice or set up recurring invoices for regular customers."
      actions={
        <>
          <Link
            to="/invoices?new=true"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Invoice
          </Link>
          <Link
            to="/invoices/recurring"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Set Up Recurring
          </Link>
        </>
      }
    />
  );
}

export function EmptyStateRoutes({ hasRoutes = false, isWorker = false }) {
  if (isWorker) {
    return (
      <EmptyState
        icon="calendar"
        heading="No routes assigned today"
        message="Your manager will assign routes to you here. Check back later."
      />
    );
  }
  return (
    <EmptyState
      icon="map"
      heading="No routes yet"
      message="Create your first route to start planning your team's day."
      actions={
        <Link
          to="/routes?new=true"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create Route
        </Link>
      }
    />
  );
}

export function EmptyStateExpenses() {
  return (
    <EmptyState
      icon="receipt"
      heading="No expenses recorded"
      message="Record your business expenses to track costs and reclaim VAT."
      actions={
        <Link
          to="/expenses?new=true"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Expense
        </Link>
      }
    />
  );
}

export function EmptyStateQuotes({ hasQuotes = false, onClearFilters }) {
  if (hasQuotes) {
    return (
      <EmptyState
        icon="quote"
        heading="No quotes match your filters"
        message="Try adjusting your filters to see different results."
        actions={
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Clear Filters
          </button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon="quote"
      heading="No quotes yet"
      message="Create a quote for a new or existing customer."
      actions={
        <Link
          to="/quotes/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create Quote
        </Link>
      }
    />
  );
}

export function EmptyStateNotifications() {
  return (
    <EmptyState
      icon="check"
      heading="You're all caught up"
      message="Notifications will appear here when something needs your attention."
    />
  );
}

export function EmptyStateActivity() {
  return (
    <EmptyState
      icon="clock"
      heading="No activity yet"
      message="Activity will appear here as your team gets to work."
    />
  );
}

export default EmptyState;