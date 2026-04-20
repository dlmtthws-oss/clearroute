import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const initialInvoice = {
  invoice_number: '',
  customer_id: '',
  issue_date: new Date().toISOString().split('T')[0],
  due_date: '',
  payment_terms: 'Net 30',
  vat_rate: 0.20,
  notes: '',
  items: [{ description: '', quantity: 1, unit_price: 0, vat_rate: 0.20 }]
}

export default function InvoiceBuilder(props) {
  var invoiceId = props.invoiceId
  var onSave = props.onSave
  var onCancel = props.onCancel
  
  var invoice = useState(initialInvoice)
  var setInvoice = invoice[1]
  var invoiceValue = invoice[0]
  
  var customers = useState([])
  var setCustomers = customers[1]
  
  var loading = useState(false)
  var setLoading = loading[1]
  
  var saving = useState(false)
  var setSaving = saving[1]
  
  var items = invoiceValue.items || initialInvoice.items

  useEffect(function() {
    fetchCustomers()
    if (invoiceId) {
      fetchInvoice(invoiceId)
    } else {
      generateInvoiceNumber()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  async function fetchCustomers() {
    var result = await supabase.from('customers').select('*').order('name')
    if (result.data) setCustomers(result.data)
  }

  async function generateInvoiceNumber() {
    var year = new Date().getFullYear()
    var result = await supabase.from('invoices')
      .select('invoice_number')
      .like('invoice_number', 'INV-' + year + '%')
      .order('invoice_number', { ascending: false })
      .limit(1)
    
    var num = 1
    if (result.data && result.data[0]) {
      var parts = result.data[0].invoice_number.split('-')
      var last = parseInt(parts[1] || '0')
      num = last + 1
    }
    var padded = num.toString().padStart(4, '0')
    setInvoice(function(p) { return Object.assign({}, p, { invoice_number: 'INV-' + year + '-' + padded }) })
  }

  async function fetchInvoice(id) {
    setLoading(true)
    var result = await supabase.from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', id)
      .single()
    
    if (result.data) {
      var data = result.data
      setInvoice({
        invoice_number: data.invoice_number,
        customer_id: data.customer_id,
        issue_date: data.issue_date,
        due_date: data.due_date,
        payment_terms: data.payment_terms,
        vat_rate: data.vat_rate,
        notes: data.notes,
        items: data.invoice_items || initialInvoice.items
      })
    }
    setLoading(false)
  }

  function calculateTotals() {
    var subtotal = 0
    var itemsVat = 0
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      subtotal += item.quantity * item.unit_price
      itemsVat += item.quantity * item.unit_price * item.vat_rate
    }
    var vatAmount = invoiceValue.vat_rate > 0 ? subtotal * invoiceValue.vat_rate : itemsVat
    return { subtotal: subtotal, vatAmount: vatAmount, total: subtotal + vatAmount }
  }

  function handleItemChange(index, field, value) {
    var newItems = items.slice()
    newItems[index] = Object.assign({}, newItems[index], { [field]: field === 'description' ? value : Number(value) })
    setInvoice(function(p) { return Object.assign({}, p, { items: newItems }) })
  }

  function addItem() {
    var newItem = { description: '', quantity: 1, unit_price: 0, vat_rate: invoiceValue.vat_rate }
    setInvoice(function(p) { return Object.assign({}, p, { items: p.items.concat([newItem]) }) })
  }

  function removeItem(index) {
    if (items.length > 1) {
      var newItems = items.filter(function(x, i) { return i !== index })
      setInvoice(function(p) { return Object.assign({}, p, { items: newItems }) })
    }
  }

  async function handleSave() {
    setSaving(true)
    
    var totals = calculateTotals()
    
    var invoiceData = {
      invoice_number: invoiceValue.invoice_number,
      customer_id: invoiceValue.customer_id || null,
      issue_date: invoiceValue.issue_date,
      due_date: invoiceValue.due_date || null,
      subtotal: totals.subtotal,
      vat_amount: totals.vatAmount,
      total: totals.total,
      vat_rate: invoiceValue.vat_rate,
      payment_terms: invoiceValue.payment_terms,
      notes: invoiceValue.notes || null,
      status: 'draft'
    }

    var invId = invoiceId
    var error = null

    if (invoiceId) {
      var updRes = await supabase.from('invoices').update(invoiceData).eq('id', invoiceId)
      error = updRes.error
    } else {
      var insRes = await supabase.from('invoices').insert(invoiceData).select().single()
      if (insRes.error) {
        error = insRes.error
      } else {
        invId = insRes.data.id
      }
    }

    if (error) {
      console.error('Save error:', error)
      setSaving(false)
      return
    }

    await supabase.from('invoice_items').delete().eq('invoice_id', invId)
    
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      var itemData = {
        invoice_id: invId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        tax_amount: item.quantity * item.unit_price * item.vat_rate,
        line_total: item.quantity * item.unit_price,
        sort_order: i
      }
      await supabase.from('invoice_items').insert(itemData)
    }
    
    setSaving(false)
    if (onSave) onSave(invId)
  }

  var totals = calculateTotals()
  var customerList = customers[0]
  var loadingValue = loading[0]
  var savingValue = saving[0]

  if (loadingValue) {
    return (
      React.createElement('div', { className: 'flex items-center justify-center h-64', role: 'status', 'aria-label': 'Loading invoice' },
        React.createElement('div', { className: 'animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900' })
      )
    )
  }

  return (
    React.createElement('div', { className: 'bg-white rounded-lg shadow' },
      React.createElement('div', { className: 'px-6 py-4 border-b border-gray-200' },
        React.createElement('div', { className: 'flex items-center justify-between' },
          React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' },
            invoiceId ? 'Edit Invoice' : 'New Invoice'
          ),
          React.createElement('div', { className: 'flex gap-3' },
            React.createElement('button', {
              type: 'button',
              onClick: handleSave,
              disabled: savingValue,
              className: 'px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50'
            }, savingValue ? 'Saving...' : 'Save Draft'),
            React.createElement('button', {
              type: 'button',
              onClick: onCancel,
              className: 'px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md'
            }, 'Cancel')
          )
        )
      ),
      React.createElement('div', { className: 'p-6 space-y-6' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
          React.createElement('div', null,
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' }, 'Invoice Number'),
            React.createElement('input', {
              type: 'text',
              value: invoiceValue.invoice_number,
              onChange: function(e) { setInvoice(function(p) { return Object.assign({}, p, { invoice_number: e.target.value }) }) },
              className: 'w-full px-3 py-2 border border-gray-300 rounded-md'
            })
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' }, 'Customer'),
            React.createElement('select', {
              value: invoiceValue.customer_id || '',
              onChange: function(e) { setInvoice(function(p) { return Object.assign({}, p, { customer_id: e.target.value }) }) },
              className: 'w-full px-3 py-2 border border-gray-300 rounded-md'
            },
              React.createElement('option', { value: '' }, 'Select customer...'),
              customerList.map(function(c) {
                return React.createElement('option', { key: c.id, value: c.id }, c.name)
              })
            )
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' }, 'Issue Date'),
            React.createElement('input', {
              type: 'date',
              value: invoiceValue.issue_date,
              onChange: function(e) { setInvoice(function(p) { return Object.assign({}, p, { issue_date: e.target.value }) }) },
              className: 'w-full px-3 py-2 border border-gray-300 rounded-md'
            })
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' }, 'Due Date'),
            React.createElement('input', {
              type: 'date',
              value: invoiceValue.due_date || '',
              onChange: function(e) { setInvoice(function(p) { return Object.assign({}, p, { due_date: e.target.value }) }) },
              className: 'w-full px-3 py-2 border border-gray-300 rounded-md'
            })
          )
        ),
        React.createElement('div', null,
          React.createElement('div', { className: 'flex items-center justify-between mb-2' },
            React.createElement('h3', { className: 'text-sm font-medium text-gray-700' }, 'Line Items'),
            React.createElement('button', {
              type: 'button',
              onClick: addItem,
              className: 'text-sm text-gray-600 hover:text-gray-900'
            }, '+ Add Item')
          ),
          items.map(function(item, index) {
            return (
              React.createElement('div', { key: index, className: 'flex items-start gap-2 mb-2' },
                React.createElement('input', {
                  type: 'text',
                  placeholder: 'Description',
                  value: item.description,
                  onChange: function(e) { handleItemChange(index, 'description', e.target.value) },
                  className: 'flex-1 px-3 py-2 border border-gray-300 rounded-md'
                }),
                React.createElement('input', {
                  type: 'number',
                  placeholder: 'Qty',
                  value: item.quantity,
                  onChange: function(e) { handleItemChange(index, 'quantity', e.target.value) },
                  className: 'w-16 px-3 py-2 border border-gray-300 rounded-md'
                }),
                React.createElement('input', {
                  type: 'number',
                  placeholder: 'Price',
                  value: item.unit_price,
                  onChange: function(e) { handleItemChange(index, 'unit_price', e.target.value) },
                  className: 'w-24 px-3 py-2 border border-gray-300 rounded-md'
                }),
                React.createElement('button', {
                  type: 'button',
                  onClick: function() { removeItem(index) },
                  className: 'p-2 text-gray-400 hover:text-red-600',
                  disabled: items.length === 1
                }, 'X')
              )
            )
          })
        ),
        React.createElement('div', { className: 'border-t pt-4' },
          React.createElement('div', { className: 'flex justify-end' },
            React.createElement('div', { className: 'w-64 space-y-2' },
              React.createElement('div', { className: 'flex justify-between text-sm' },
                React.createElement('span', { className: 'text-gray-600' }, 'Subtotal'),
                React.createElement('span', { className: 'font-medium' }, '$' + totals.subtotal.toFixed(2))
              ),
              React.createElement('div', { className: 'flex justify-between text-sm' },
                React.createElement('span', { className: 'text-gray-600' }, 'VAT (' + (invoiceValue.vat_rate * 100).toFixed(0) + '%)'),
                React.createElement('span', { className: 'font-medium' }, '$' + totals.vatAmount.toFixed(2))
              ),
              React.createElement('div', { className: 'flex justify-between text-lg font-semibold border-t pt-2' },
                React.createElement('span', null, 'Total'),
                React.createElement('span', null, '$' + totals.total.toFixed(2))
              )
            )
          )
        )
      )
    )
  )
}