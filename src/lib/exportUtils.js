import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import JSZip from 'jszip'

export function exportToCSV(data, filename, columns) {
  if (!data?.length) return

  const headers = columns.map(c => c.label)
  const keys = columns.map(c => c.key)

  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      keys.map(key => {
        let value = getNestedValue(row, key)
        if (value === null || value === undefined) return ''
        if (typeof value === 'string') {
          value = value.replace(/"/g, '""')
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = `"${value}"`
          }
        }
        if (typeof value === 'number') {
          return value.toFixed(2)
        }
        return value
      }).join(',')
    )
  ]

  const csv = csvRows.join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `${filename}.csv`)
}

export function exportToExcel(data, filename, columns, sheetName) {
  if (!data?.length) return

  const keys = columns.map(c => c.key)
  const headers = columns.map(c => c.label)

  const wsData = [
    headers,
    ...data.map(row =>
      keys.map(key => {
        let value = getNestedValue(row, key)
        if (value === null || value === undefined) return ''
        if (typeof value === 'number') return value
        if (key.includes('date') || key.includes('Date')) {
          return formatDate(value)
        }
        return value
      })
    )
  ]

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Set column widths
  const colWidths = headers.map((h, i) => ({
    wch: Math.max(h.length, 15)
  }))
  ws['!cols'] = colWidths

  // Freeze top row
  ws['!freeze'] = { x: 0, y: 1 }

  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data')

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  downloadBlob(blob, `${filename}.xlsx`)
}

export function exportToPDF(doc, filename) {
  doc.save(`${filename}.pdf`)
}

export function createPDFReport(title, dateRange, columns, data, totals = {}) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const generatedDate = new Date().toLocaleString('en-GB')

  // Header
  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, pageWidth, 20, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.text('ClearRoute', 14, 14)
  
  doc.setFontSize(10)
  doc.text(title, 14, 28)
  doc.text(`Period: ${dateRange}`, pageWidth - 14, 28, { align: 'right' })
  doc.setFontSize(8)
  doc.text(`Generated: ${generatedDate}`, pageWidth - 14, 34, { align: 'right' })

  // Table
  doc.autoTable({
    startY: 40,
    head: [columns.map(c => c.label)],
    body: data.map(row =>
      columns.map(c => formatValue(getNestedValue(row, c.key), c.type))
    ),
    foot: Object.entries(totals).length > 0
      ? [columns.map(c => {
          const value = totals[c.key]
          return value !== undefined ? formatValue(value, c.type) : ''
        })]
      : undefined,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 14, right: 14 }
  })

  // Page numbers
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(128)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' })
  }

  return doc
}

export async function createAccountantPack(data, dateRange) {
  const zip = new JSZip()
  const timestamp = new Date().toISOString().split('T')[0]
  const filename = `ClearRoute_AccountantPack_${dateRange.from}_${dateRange.to}.zip`

  // Add CSV files
  if (data.invoices) {
    zip.file(`invoices_${timestamp}.csv`, csvFromData(data.invoices.columns, data.invoices.data))
  }
  if (data.payments) {
    zip.file(`payments_${timestamp}.csv`, csvFromData(data.payments.columns, data.payments.data))
  }
  if (data.expenses) {
    zip.file(`expenses_${timestamp}.csv`, csvFromData(data.expenses.columns, data.expenses.data))
  }
  if (data.customers) {
    zip.file(`customers_${timestamp}.csv`, csvFromData(data.customers.columns, data.customers.data))
  }

  // Add PDFs
  if (data.plReport) {
    zip.file(`pl_report_${timestamp}.pdf`, data.plReport)
  }
  if (data.vatSummary) {
    zip.file(`vat_summary_${timestamp}.pdf`, data.vatSummary)
  }

  // Add readme
  const readme = `
ClearRoute Accountant Pack
Generated: ${new Date().toLocaleString('en-GB')}
Period: ${dateRange.from} to ${dateRange.to}

Files Included:
- invoices.csv - All invoices in the period
- payments.csv - All payments received
- expenses.csv - All expenses
- customers.csv - Customer list
- pl_report.pdf - Profit & Loss Report
- vat_summary.pdf - VAT Summary

This pack was generated by ClearRoute.
Please verify all figures with your accountant before submission.
`.trim()

  zip.file('README.txt', readme)

  const content = await zip.generateAsync({ type: 'blob' })
  downloadBlob(content, filename)
}

// Helper functions
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, p) => o?.[p], obj)
}

function formatDate(date) {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleDateString('en-GB')
}

function formatValue(value, type) {
  if (value === null || value === undefined) return ''
  
  if (type === 'currency') {
    return typeof value === 'number' ? value.toFixed(2) : String(value)
  }
  if (type === 'date') {
    return formatDate(value)
  }
  if (type === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  
  return String(value)
}

function csvFromData(columns, data) {
  const headers = columns.map(c => c.label)
  const keys = columns.map(c => c.key)

  const rows = [
    headers.join(','),
    ...data.map(row =>
      keys.map(key => {
        let value = getNestedValue(row, key)
        if (value === null || value === undefined) return ''
        if (typeof value === 'string') {
          value = value.replace(/"/g, '""')
          if (value.includes(',')) value = `"${value}"`
        }
        return value
      }).join(',')
    )
  ]

  return '\ufeff' + rows.join('\n')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Show export confirmation for large datasets
export function confirmLargeExport(rowCount, maxRows = 500) {
  if (rowCount > maxRows) {
    return window.confirm(`You are about to export ${rowCount} rows. Continue?`)
  }
  return true
}

// Format filename with date range
export function formatExportFilename(type, dateFrom, dateTo) {
  const from = dateFrom?.replace(/-/g, '') || ''
  const to = dateTo?.replace(/-/g, '') || ''
  
  if (from && to) {
    return `ClearRoute_${type}_${from}_${to}`
  }
  return `ClearRoute_${type}_${new Date().toISOString().split('T')[0]}`
}

// Column definitions for each export type
export const CUSTOMER_COLUMNS = [
  { key: 'name', label: 'Customer Name' },
  { key: 'address_line_1', label: 'Address Line 1' },
  { key: 'address_line_2', label: 'Address Line 2' },
  { key: 'city', label: 'City' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'service_type', label: 'Service Type' },
  { key: 'payment_method', label: 'Payment Method' },
  { key: 'mandate_status', label: 'Direct Debit Status' },
  { key: 'created_at', label: 'Created Date', type: 'date' }
]

export const INVOICE_COLUMNS = [
  { key: 'invoice_number', label: 'Invoice Number' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'customer_address', label: 'Customer Address' },
  { key: 'issue_date', label: 'Issue Date', type: 'date' },
  { key: 'due_date', label: 'Due Date', type: 'date' },
  { key: 'status', label: 'Status' },
  { key: 'subtotal', label: 'Subtotal', type: 'currency' },
  { key: 'vat_amount', label: 'VAT', type: 'currency' },
  { key: 'total', label: 'Total', type: 'currency' },
  { key: 'amount_paid', label: 'Paid', type: 'currency' },
  { key: 'balance_outstanding', label: 'Outstanding', type: 'currency' },
  { key: 'payment_method', label: 'Payment Method' },
  { key: 'paid_at', label: 'Payment Date', type: 'date' },
  { key: 'route_name', label: 'Route' }
]

export const PAYMENT_COLUMNS = [
  { key: 'payment_date', label: 'Payment Date', type: 'date' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'invoice_number', label: 'Invoice' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'payment_method', label: 'Method' },
  { key: 'reference', label: 'Reference' },
  { key: 'notes', label: 'Notes' }
]

export const EXPENSE_COLUMNS = [
  { key: 'expense_date', label: 'Date', type: 'date' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'vat_reclaimable', label: 'VAT Reclaimable', type: 'boolean' },
  { key: 'vat_amount', label: 'VAT', type: 'currency' },
  { key: 'net_amount', label: 'Net', type: 'currency' },
  { key: 'has_receipt', label: 'Receipt Attached', type: 'boolean' }
]

export const ROUTE_PERFORMANCE_COLUMNS = [
  { key: 'route_name', label: 'Route Name' },
  { key: 'session_date', label: 'Date', type: 'date' },
  { key: 'worker_name', label: 'Worker' },
  { key: 'estimated_minutes', label: 'Est. Minutes' },
  { key: 'actual_minutes', label: 'Actual Minutes' },
  { key: 'variance_minutes', label: 'Variance' },
  { key: 'variance_percent', label: 'Variance %' },
  { key: 'jobs_completed', label: 'Jobs Done' },
  { key: 'jobs_skipped', label: 'Jobs Skipped' }
]