export function formatCurrency(amount, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency
  }).format(amount || 0)
}

export function formatCurrencyCompact(amount) {
  if (amount >= 1000000) {
    return `£${(amount / 1000000).toFixed(1)}M`
  }
  if (amount >= 1000) {
    return `£${(amount / 1000).toFixed(1)}K`
  }
  return `£${amount.toFixed(2)}`
}

export function parseCurrency(value) {
  if (typeof value === 'number') return value
  return parseFloat(value?.replace(/[^0-9.-]/g, '') || 0)
}