import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createAccountantPack, exportToCSV, CUSTOMER_COLUMNS, INVOICE_COLUMNS, EXPENSE_COLUMNS, formatExportFilename, createPDFReport } from '../lib/exportUtils'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'

export default function Settings({ user }) {
  const navigate = useNavigate()
  const [settings, setSettings] = useState({
    company_name: 'ClearRoute Ltd',
    address_line_1: '',
    address_line_2: '',
    city: '',
    county: '',
    postcode: '',
    country: 'United Kingdom',
    phone: '',
    email: '',
    website: '',
    vat_number: '',
    company_number: '',
    logo_url: '',
    primary_colour: '#2563EB',
    default_payment_terms: 30,
    default_vat_rate: 20,
    invoice_prefix: 'INV-',
    invoice_starting_number: 1,
    invoice_footer_text: '',
    vat_registration_number: '',
    vat_accounting_scheme: 'cash',
    vat_period: 'quarterly'
  })
  const [emailTemplates, setEmailTemplates] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [accountantDateFrom, setAccountantDateFrom] = useState('')
  const [accountantDateTo, setAccountantDateTo] = useState('')
  const [generatingPack, setGeneratingPack] = useState(false)
  const [initialSettings, setInitialSettings] = useState(null)
  const [xeroConnection, setXeroConnection] = useState(null)
  const [xeroSyncLog, setXeroSyncLog] = useState([])
  const [xeroSyncing, setXeroSyncing] = useState(false)
  const [xeroTesting, setXeroTesting] = useState(false)
  const [xeroSettings, setXeroSettings] = useState({
    auto_sync_invoices: true,
    auto_sync_expenses: true,
    auto_sync_payments: true,
    account_code_mappings: { fuel: '449', equipment: '720', supplies: '400', insurance: '478', other: '404' }
  })
  const [editingMapping, setEditingMapping] = useState(null)
  const [qboConnection, setQboConnection] = useState(null)
  const [qboSyncLog, setQboSyncLog] = useState([])
  const [qboSyncing, setQboSyncing] = useState(false)
  const [qboTesting, setQboTesting] = useState(false)
  const [xeroLogFilter, setXeroLogFilter] = useState('all')
  const [qboLogFilter, setQboLogFilter] = useState('all')
  const [qboSettings, setQboSettings] = useState({
    auto_sync_invoices: true,
    auto_sync_expenses: true,
    auto_sync_payments: true,
    expense_account_mappings: { fuel: { id: '', name: 'Vehicle' }, equipment: { id: '', name: 'Equipment' }, supplies: { id: '', name: 'Supplies & Materials' }, insurance: { id: '', name: 'Insurance' }, other: { id: '', name: 'Other Business Expenses' } }
  })
  const [qboAccounts, setQboAccounts] = useState({ income: [], expense: [], bank: [] })
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)

  const canEdit = user?.role === 'admin'

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const { data } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single()
    
    if (data) {
      setSettings(data)
      setInitialSettings(data)
    }

    const { data: templates } = await supabase
      .from('email_templates')
      .select('*')
      .eq('is_active', true)
    
    setEmailTemplates(templates || [])

    if (user?.id) {
      const { data: connection } = await supabase
        .from('xero_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single()
      setXeroConnection(connection || null)

      const { data: syncSettings } = await supabase
        .from('xero_sync_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()
      if (syncSettings) {
        setXeroSettings(syncSettings)
      }

      const { data: syncLog } = await supabase
        .from('xero_sync_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)
      setXeroSyncLog(syncLog || [])
    }

    if (user?.id) {
      const { data: qboConnection } = await supabase
        .from('quickbooks_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single()
      setQboConnection(qboConnection || null)

      const { data: qboSyncSettings } = await supabase
        .from('quickbooks_sync_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()
      if (qboSyncSettings) {
        setQboSettings(qboSyncSettings)
      }

      if (qboConnection) {
        setLoadingAccounts(true)
        try {
          const { data: accounts, error: accountsError } = await supabase.functions.invoke('qbo-get-accounts', {
            body: { userId: user.id }
          })
          if (!accountsError && accounts) {
            setQboAccounts(accounts)
          }
        } catch (err) {
          console.error('Failed to load QBO accounts:', err)
        }
        setLoadingAccounts(false)
      }

      const { data: qboSyncLog } = await supabase
        .from('quickbooks_sync_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)
      setQboSyncLog(qboSyncLog || [])
    }
  }

  async function handleSave(oldSettings) {
    setSaving(true)
    
    await supabase
      .from('company_settings')
      .upsert({ ...settings, updated_at: new Date().toISOString() })
    
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    
    logAuditEvent(
      AUDIT_ACTIONS.SETTINGS_COMPANY_UPDATED,
      'settings',
      null,
      'Company Settings',
      oldSettings,
      settings
    )
  }

  async function handleAccountantPack() {
    if (!accountantDateFrom || !accountantDateTo) {
      alert('Please select a date range')
      return
    }

    setGeneratingPack(true)

    try {
      const [{ data: invoices }, { data: payments }, { data: expenses }, { data: customers }, { data: company }] = await Promise.all([
        supabase.from('invoices').select('*, customers(name), routes(name)').gte('issue_date', accountantDateFrom).lte('issue_date', accountantDateTo),
        supabase.from('payments').select('*, customers(name), invoices(invoice_number)').gte('payment_date', accountantDateFrom).lte('payment_date', accountantDateTo),
        supabase.from('expenses').select('*').gte('expense_date', accountantDateFrom).lte('expense_date', accountantDateTo),
        supabase.from('customers').select('*').order('name'),
        supabase.from('company_settings').select('*').limit(1).single()
      ])

      // Format data for exports
      const invoiceData = (invoices || []).map(inv => ({
        invoice_number: inv.invoice_number,
        customer_name: inv.customers?.name || '',
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        status: inv.status,
        subtotal: inv.subtotal,
        vat_amount: inv.vat_amount,
        total: inv.total,
        amount_paid: inv.amount_paid || 0,
        balance_outstanding: inv.total - (inv.amount_paid || 0)
      }))

      const paymentData = (payments || []).map(pay => ({
        payment_date: pay.payment_date,
        customer_name: pay.customers?.name || '',
        invoice_number: pay.invoices?.invoice_number || '',
        amount: pay.amount,
        payment_method: pay.method,
        reference: pay.reference || '',
        notes: pay.notes || ''
      }))

      const expenseData = (expenses || []).map(exp => ({
        expense_date: exp.expense_date,
        description: exp.description,
        category: exp.category,
        supplier: exp.supplier || '',
        amount: exp.amount,
        vat_reclaimable: exp.vat_reclaimable,
        vat_amount: exp.vat_amount || 0,
        net_amount: exp.amount - (exp.vat_amount || 0),
        has_receipt: !!exp.receipt_url
      }))

      const customerData = (customers || []).map(c => ({
        name: c.name,
        address_line_1: c.address_line_1 || '',
        address_line_2: c.address_line_2 || '',
        city: c.city || '',
        postcode: c.postcode || '',
        email: c.email || '',
        phone: c.phone || '',
        service_type: c.service_type || '',
        payment_method: c.payment_method || '',
        mandate_status: c.mandate_status || '',
        created_at: c.created_at
      }))

      // Generate PDFs
      const dateRange = `${accountantDateFrom} to ${accountantDateTo}`
      const plColumns = [
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', type: 'currency' }
      ]
      const plData = [
        { description: 'Revenue', amount: invoices?.reduce((s, i) => s + (i.total || 0), 0) || 0 },
        { description: 'Expenses', amount: -(expenses?.reduce((s, e) => s + (e.amount || 0), 0) || 0) }
      ]
      const plTotals = { amount: (invoices?.reduce((s, i) => s + (i.total || 0), 0) || 0) - (expenses?.reduce((s, e) => s + (e.amount || 0), 0) || 0) }
      const plDoc = createPDFReport('Profit & Loss Report', dateRange, plColumns, plData, plTotals)
      
      const vatColumns = [
        { key: 'box', label: 'Box' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', type: 'currency' }
      ]
      const vatData = [
        { box: '1', description: 'VAT due on sales', amount: invoices?.reduce((s, i) => s + (i.vat_amount || 0), 0) || 0 },
        { box: '4', description: 'VAT reclaimed', amount: expenses?.reduce((s, e) => s + (e.vat_amount || 0), 0) || 0 },
        { box: '5', description: 'Net VAT payable', amount: (invoices?.reduce((s, i) => s + (i.vat_amount || 0), 0) || 0) - (expenses?.reduce((s, e) => s + (e.vat_amount || 0), 0) || 0) }
      ]
      const vatTotals = { amount: (invoices?.reduce((s, i) => s + (i.vat_amount || 0), 0) || 0) - (expenses?.reduce((s, e) => s + (e.vat_amount || 0), 0) || 0) }
      const vatDoc = createPDFReport('VAT Summary', dateRange, vatColumns, vatData, vatTotals)

      await createAccountantPack({
        invoices: { columns: INVOICE_COLUMNS, data: invoiceData },
        payments: { columns: [], data: paymentData },
        expenses: { columns: EXPENSE_COLUMNS, data: expenseData },
        customers: { columns: CUSTOMER_COLUMNS, data: customerData },
        plReport: plDoc.output('blob'),
        vatSummary: vatDoc.output('blob')
      }, { from: accountantDateFrom, to: accountantDateTo })

    } catch (err) {
      alert('Failed to generate accountant pack: ' + err.message)
    }

    setGeneratingPack(false)
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    
    if (file.size > 2 * 1024 * 1024) {
      alert('File size must be under 2MB')
      return
    }

    setLogoUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `logos/company-logo.${fileExt}`
      
      const { error: uploadError } = await supabase.storage
        .from('company-assets')
        .upload(fileName, file, { upsert: true })
      
      if (uploadError) throw uploadError
      
      const { data: { publicUrl } } = supabase.storage
        .from('company-assets')
        .getPublicUrl(fileName)
      
      setSettings({ ...settings, logo_url: publicUrl })
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setLogoUploading(false)
  }

  async function handleDeleteLogo() {
    if (!window.confirm('Remove logo?')) return
    setSettings({ ...settings, logo_url: '' })
  }

  async function handleSaveTemplate(template) {
    await supabase
      .from('email_templates')
      .update({
        subject: template.subject,
        body: template.body,
        updated_at: new Date().toISOString()
      })
      .eq('id', template.id)
    
    setEditingTemplate(null)
    loadSettings()
  }

  const handleResetTemplate = async (templateType) => {
    const templates = {
      invoice: {
        subject: 'Invoice {{invoice_number}} from {{company_name}}',
        body: `Dear {{customer_name}},

Please find attached your invoice {{invoice_number}} for the amount of {{invoice_total}}.

Payment is due by {{due_date}}.

Kind regards,
{{company_name}}`
      },
      overdue_reminder: {
        subject: 'Payment Reminder — Invoice {{invoice_number}} Overdue',
        body: `Dear {{customer_name}},

This is a friendly reminder that invoice {{invoice_number}} for {{invoice_total}} was due on {{due_date}} and remains unpaid.

Kind regards,
{{company_name}}`
      },
      payment_confirmation: {
        subject: 'Payment Received — Invoice {{invoice_number}}',
        body: `Dear {{customer_name}},

Thank you — we have received your payment of {{invoice_total}} for invoice {{invoice_number}}.

Kind regards,
{{company_name}}`
      },
      payment_failed: {
        subject: 'Direct Debit Failed — Invoice {{invoice_number}}',
        body: `Dear {{customer_name}},

Unfortunately your direct debit payment of {{invoice_total}} for invoice {{invoice_number}} was unsuccessful.

Kind regards,
{{company_name}}`
      }
    }

    const template = templates[templateType]
    if (template) {
      await supabase
        .from('email_templates')
        .update({ ...template, updated_at: new Date().toISOString() })
        .eq('template_type', templateType)
      loadSettings()
    }
  }

  const placeholders = [
    '{{customer_name}}', '{{invoice_number}}', '{{invoice_total}}',
    '{{due_date}}', '{{company_name}}'
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        {canEdit && (
          <button
            onClick={() => handleSave(initialSettings)}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
        )}
        {canEdit && (
          <button
            onClick={async () => {
              if (window.confirm('Restart the setup wizard? This will show the onboarding wizard again.')) {
                await supabase
                  .from('company_settings')
                  .upsert({
                    onboarding_completed: false,
                    onboarding_step: 0,
                    updated_at: new Date().toISOString()
                  })
                navigate('/onboarding')
              }
            }}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 ml-2"
          >
            Restart Setup
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b flex-wrap">
        {['profile', 'branding', 'invoices', 'vat', 'accountant', 'emails', 'xero', 'quickbooks'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 -mb-px ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Profile Section */}
      {activeTab === 'profile' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">Company Profile</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Company Name *</label>
              <input
                type="text"
                value={settings.company_name}
                onChange={e => setSettings({ ...settings, company_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <input
                type="email"
                value={settings.email}
                onChange={e => setSettings({ ...settings, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                type="tel"
                value={settings.phone}
                onChange={e => setSettings({ ...settings, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Website</label>
              <input
                type="url"
                value={settings.website}
                onChange={e => setSettings({ ...settings, website: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Address Line 1</label>
              <input
                type="text"
                value={settings.address_line_1}
                onChange={e => setSettings({ ...settings, address_line_1: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Address Line 2</label>
              <input
                type="text"
                value={settings.address_line_2}
                onChange={e => setSettings({ ...settings, address_line_2: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City *</label>
              <input
                type="text"
                value={settings.city}
                onChange={e => setSettings({ ...settings, city: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">County</label>
              <input
                type="text"
                value={settings.county}
                onChange={e => setSettings({ ...settings, county: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Postcode *</label>
              <input
                type="text"
                value={settings.postcode}
                onChange={e => setSettings({ ...settings, postcode: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT Number</label>
              <input
                type="text"
                value={settings.vat_number}
                onChange={e => setSettings({ ...settings, vat_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Company Number</label>
              <input
                type="text"
                value={settings.company_number}
                onChange={e => setSettings({ ...settings, company_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Branding Section */}
      {activeTab === 'branding' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">Branding</h2>
          
          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">Logo</label>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              {settings.logo_url ? (
                <div>
                  <img src={settings.logo_url} alt="Logo" className="h-20 mx-auto mb-2 object-contain" />
                  <button
                    onClick={handleDeleteLogo}
                    className="text-red-500 text-sm"
                  >
                    Remove Logo
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                    disabled={logoUploading}
                  />
                  <label htmlFor="logo-upload" className="cursor-pointer">
                    <p className="text-gray-500">
                      {logoUploading ? 'Uploading...' : 'Drag & drop or click to upload'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG, WebP, SVG (max 2MB)</p>
                  </label>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Primary Colour</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={settings.primary_colour}
                onChange={e => setSettings({ ...settings, primary_colour: e.target.value })}
                className="w-12 h-12 rounded cursor-pointer"
              />
              <input
                type="text"
                value={settings.primary_colour}
                onChange={e => setSettings({ ...settings, primary_colour: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Invoices Section */}
      {activeTab === 'invoices' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">Invoice Defaults</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Payment Terms</label>
              <select
                value={settings.default_payment_terms}
                onChange={e => setSettings({ ...settings, default_payment_terms: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Default VAT Rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={settings.default_vat_rate}
                onChange={e => setSettings({ ...settings, default_vat_rate: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Invoice Prefix</label>
              <input
                type="text"
                value={settings.invoice_prefix}
                onChange={e => setSettings({ ...settings, invoice_prefix: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Starting Number</label>
              <input
                type="number"
                value={settings.invoice_starting_number}
                onChange={e => setSettings({ ...settings, invoice_starting_number: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Footer Text</label>
              <textarea
                value={settings.invoice_footer_text}
                onChange={e => setSettings({ ...settings, invoice_footer_text: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
                placeholder="Bank details, terms, thank you message..."
              />
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-500">
                Next invoice: {settings.invoice_prefix}{String(settings.invoice_starting_number).padStart(4, '0')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VAT Section */}
      {activeTab === 'vat' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">VAT Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">VAT Registration Number</label>
              <input
                type="text"
                value={settings.vat_registration_number}
                onChange={e => setSettings({ ...settings, vat_registration_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="GB123456789"
              />
              <p className="text-xs text-gray-500 mt-1">Required for Making Tax Digital submission</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT Accounting Scheme</label>
              <select
                value={settings.vat_accounting_scheme}
                onChange={e => setSettings({ ...settings, vat_accounting_scheme: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="cash">Cash Accounting</option>
                <option value="standard">Standard Accruals</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {settings.vat_accounting_scheme === 'cash' 
                  ? 'Box 1 calculated on payment date (most common for small businesses)'
                  : 'Box 1 calculated on invoice date'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT Period</label>
              <select
                value={settings.vat_period}
                onChange={e => setSettings({ ...settings, vat_period: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Emails Section */}
      {activeTab === 'emails' && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">Email Templates</h2>
          
          {emailTemplates.map(template => (
            <div key={template.id} className="border rounded-lg p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium">{template.template_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</h3>
                {canEdit && (
                  <button
                    onClick={() => handleResetTemplate(template.template_type)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Reset to Default
                  </button>
                )}
              </div>
              
              {editingTemplate?.id === template.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editingTemplate.subject}
                    onChange={e => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Subject"
                  />
                  <textarea
                    value={editingTemplate.body}
                    onChange={e => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
                    rows={8}
                    placeholder="Email body"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveTemplate(editingTemplate)}
                      className="px-3 py-1 bg-blue-600 text-white rounded"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingTemplate(null)}
                      className="px-3 py-1 bg-gray-200 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium">{template.subject}</p>
                  <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap">{template.body}</p>
                  {canEdit && (
                    <button
                      onClick={() => setEditingTemplate(template)}
                      className="mt-2 text-blue-600 text-sm"
                    >
                      Edit Template
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-2">Available placeholders:</p>
            <div className="flex flex-wrap gap-2">
              {placeholders.map(p => (
                <code key={p} className="text-xs bg-white px-2 py-1 rounded">{p}</code>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Accountant Pack Section */}
      {activeTab === 'accountant' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">Accountant Export</h2>
          <p className="text-sm text-gray-600 mb-4">
            Generate a complete export pack for your accountant. This includes all invoices, payments, expenses, 
            customers, Profit & Loss report, and VAT summary in a single ZIP download.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Date</label>
              <input
                type="date"
                value={accountantDateFrom}
                onChange={e => setAccountantDateFrom(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Date</label>
              <input
                type="date"
                value={accountantDateTo}
                onChange={e => setAccountantDateTo(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>

          <button
            onClick={handleAccountantPack}
            disabled={generatingPack}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {generatingPack ? 'Generating...' : 'Generate Accountant Pack'}
          </button>

          <p className="text-xs text-gray-500 mt-2">
            Package includes: invoices.csv, payments.csv, expenses.csv, customers.csv, pl_report.pdf, vat_summary.pdf
          </p>
        </div>
      )}

      {/* Xero Section */}
      {activeTab === 'xero' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">Xero Accounting Integration</h2>

          {xeroConnection && qboConnection && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-amber-700 text-sm">
                ⚠️ You have both Xero and QuickBooks connected. We recommend using only one accounting 
                integration to avoid duplicate records. Please speak to your accountant about which to use.
              </p>
            </div>
          )}

          {!xeroConnection ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">📊</div>
              <p className="text-gray-600 mb-4">
                Connect to Xero to automatically sync your invoices, customers, expenses, and payments.
              </p>
              <button
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke('xero-auth-start', {
                      body: { userId: user.id }
                    })
                    if (error) throw error
                    if (data?.authUrl) {
                      window.location.href = data.authUrl
                    }
                  } catch (err) {
                    alert('Failed to start Xero connection: ' + err.message)
                  }
                }}
                className="px-4 py-2 bg-[#13B5EA] text-white rounded-lg hover:bg-[#0F9BC0]"
              >
                Connect to Xero
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 rounded-lg">
                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                <span className="font-medium text-green-700">Connected to Xero</span>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600">Organisation: {xeroConnection.tenant_name}</p>
                <p className="text-xs text-gray-500">Tenant ID: {xeroConnection.tenant_id}</p>
                <p className="text-xs text-gray-500">
                  Last synced: {xeroConnection.last_synced_at ? new Date(xeroConnection.last_synced_at).toLocaleString() : 'Never'}
                </p>
              </div>

              <div className="flex gap-2 mb-6">
                <button
                  onClick={async () => {
                    setXeroTesting(true)
                    try {
                      const { data, error } = await supabase.functions.invoke('xero-test-connection', {
                        body: { userId: user.id }
                      })
                      if (error) throw error
                      if (data?.connected) {
                        alert('Connection successful! Connected to: ' + data.organisation?.name)
                      } else {
                        alert('Connection test failed: ' + (data?.error || 'Unknown error'))
                      }
                    } catch (err) {
                      alert('Connection test failed: ' + err.message)
                    }
                    setXeroTesting(false)
                  }}
                  disabled={xeroTesting}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  {xeroTesting ? 'Testing...' : 'Test Connection'}
                </button>

                <button
                  onClick={async () => {
                    setXeroSyncing(true)
                    try {
                      const { data, error } = await supabase.functions.invoke('xero-full-sync', {
                        body: { userId: user.id, entityType: 'all' }
                      })
                      if (error) throw error
                      alert(`Sync complete! Synced: ${data?.summary?.synced}, Errors: ${data?.summary?.errors}`)
                      loadSettings()
                    } catch (err) {
                      alert('Sync failed: ' + err.message)
                    }
                    setXeroSyncing(false)
                  }}
                  disabled={xeroSyncing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {xeroSyncing ? 'Syncing...' : 'Sync All Now'}
                </button>

                <button
                  onClick={async () => {
                    if (!window.confirm('Disconnect from Xero? Your sync data will be preserved.')) return
                    try {
                      await supabase.from('xero_connections')
                        .update({ is_active: false })
                        .eq('user_id', user.id)
                      setXeroConnection(null)
                    } catch (err) {
                      alert('Failed to disconnect: ' + err.message)
                    }
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Disconnect
                </button>
              </div>

              <div className="mb-6">
                <h3 className="font-medium mb-3">Sync Settings</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={xeroSettings.auto_sync_invoices}
                      onChange={async (e) => {
                        const newSettings = { ...xeroSettings, auto_sync_invoices: e.target.checked }
                        setXeroSettings(newSettings)
                        await supabase.from('xero_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">Auto-sync invoices</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={xeroSettings.auto_sync_expenses}
                      onChange={async (e) => {
                        const newSettings = { ...xeroSettings, auto_sync_expenses: e.target.checked }
                        setXeroSettings(newSettings)
                        await supabase.from('xero_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">Auto-sync expenses</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={xeroSettings.auto_sync_payments}
                      onChange={async (e) => {
                        const newSettings = { ...xeroSettings, auto_sync_payments: e.target.checked }
                        setXeroSettings(newSettings)
                        await supabase.from('xero_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">Auto-sync payments</span>
                  </label>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="font-medium mb-3">Account Code Mappings</h3>
                <p className="text-xs text-gray-500 mb-2">Map ClearRoute categories to Xero account codes</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">ClearRoute Category</th>
                      <th className="text-left py-2">Xero Account Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(xeroSettings.account_code_mappings || {}).map(([category, code]) => (
                      <tr key={category} className="border-b">
                        <td className="py-2 capitalize">{category}</td>
                        <td className="py-2">
                          {editingMapping === category ? (
                            <input
                              type="text"
                              defaultValue={code}
                              onBlur={async (e) => {
                                const newMappings = { ...xeroSettings.account_code_mappings, [category]: e.target.value }
                                setXeroSettings({ ...xeroSettings, account_code_mappings: newMappings })
                                await supabase.from('xero_sync_settings').upsert({ ...xeroSettings, account_code_mappings: newMappings, user_id: user.id }, { onConflict: 'user_id' })
                                setEditingMapping(null)
                              }}
                              className="w-24 px-2 py-1 border rounded"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => setEditingMapping(category)}
                              className="cursor-pointer hover:text-blue-600"
                            >
                              {code}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium">Sync Log</h3>
                  <select
                    value={xeroLogFilter}
                    onChange={(e) => setXeroLogFilter(e.target.value)}
                    className="px-2 py-1 border rounded text-sm"
                  >
                    <option value="all">All</option>
                    <option value="success">Success</option>
                    <option value="error">Errors</option>
                  </select>
                </div>
                <div className="max-h-64 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Entity</th>
                        <th className="text-left px-3 py-2">Direction</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {xeroSyncLog.filter(l => xeroLogFilter === 'all' || l.status === xeroLogFilter).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-gray-500">No sync history</td>
                        </tr>
                      ) : (
                        xeroSyncLog.filter(l => xeroLogFilter === 'all' || l.status === xeroLogFilter).slice(0, 20).map((log) => (
                          <tr key={log.id} className="border-t">
                            <td className="px-3 py-2">{log.entity_type}</td>
                            <td className="px-3 py-2">{log.direction === 'to_xero' ? '→ Xero' : '← Xero'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs ${log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            <td className="px-3 py-2">
                              {log.status === 'error' && (
                                <button
                                  onClick={async () => {
                                    try {
                                      if (log.entity_type === 'invoice') {
                                        await supabase.functions.invoke('xero-sync-invoice', { body: { invoiceId: log.entity_id, userId: user.id } })
                                      } else if (log.entity_type === 'customer') {
                                        await supabase.functions.invoke('xero-sync-customer', { body: { customerId: log.entity_id, userId: user.id } })
                                      } else if (log.entity_type === 'expense') {
                                        await supabase.functions.invoke('xero-sync-expense', { body: { expenseId: log.entity_id, userId: user.id } })
                                      }
                                      loadSettings()
                                    } catch (err) { alert(err.message) }
                                  }}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Retry
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* QuickBooks Section */}
      {activeTab === 'quickbooks' && canEdit && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="font-medium mb-4">QuickBooks Online Integration</h2>

          {xeroConnection && qboConnection && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-amber-700 text-sm">
                ⚠️ You have both Xero and QuickBooks connected. We recommend using only one accounting 
                integration to avoid duplicate records. Please speak to your accountant about which to use.
              </p>
            </div>
          )}

          {!qboConnection ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">📚</div>
              <p className="text-gray-600 mb-4">
                Connect to QuickBooks Online to automatically sync your invoices, customers, expenses, and payments.
              </p>
              <button
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke('qbo-auth-start', {
                      body: { userId: user.id }
                    })
                    if (error) throw error
                    if (data?.authUrl) {
                      const redirectUrl = `${window.location.origin}/settings/quickbooks-callback`
                      const authUrlWithRedirect = `${data.authUrl}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(data.state)}`
                      window.location.href = authUrlWithRedirect
                    }
                  } catch (err) {
                    alert('Failed to start QuickBooks connection: ' + err.message)
                  }
                }}
                className="px-4 py-2 bg-[#2CA01C] text-white rounded-lg hover:bg-[#248515]"
              >
                Connect to QuickBooks
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 rounded-lg">
                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                <span className="font-medium text-green-700">Connected to QuickBooks</span>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600">Company: {qboConnection.company_name}</p>
                <p className="text-xs text-gray-500">Realm ID: {qboConnection.realm_id}</p>
                <p className="text-xs text-gray-500">
                  Last synced: {qboConnection.last_synced_at ? new Date(qboConnection.last_synced_at).toLocaleString() : 'Never'}
                </p>
              </div>

              <div className="flex gap-2 mb-6">
                <button
                  onClick={async () => {
                    setQboTesting(true)
                    try {
                      const { data, error } = await supabase.functions.invoke('qbo-test-connection', {
                        body: { userId: user.id }
                      })
                      if (error) throw error
                      if (data?.connected) {
                        alert('Connection successful! Connected to: ' + data.organisation?.name)
                      } else {
                        alert('Connection test failed: ' + (data?.error || 'Unknown error'))
                      }
                    } catch (err) {
                      alert('Connection test failed: ' + err.message)
                    }
                    setQboTesting(false)
                  }}
                  disabled={qboTesting}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  {qboTesting ? 'Testing...' : 'Test Connection'}
                </button>

                <button
                  onClick={async () => {
                    setQboSyncing(true)
                    try {
                      const { data, error } = await supabase.functions.invoke('qbo-full-sync', {
                        body: { userId: user.id, entityType: 'all' }
                      })
                      if (error) throw error
                      alert(`Sync complete! Synced: ${data?.summary?.synced}, Errors: ${data?.summary?.errors}`)
                      loadSettings()
                    } catch (err) {
                      alert('Sync failed: ' + err.message)
                    }
                    setQboSyncing(false)
                  }}
                  disabled={qboSyncing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {qboSyncing ? 'Syncing...' : 'Sync All Now'}
                </button>

                <button
                  onClick={async () => {
                    if (!window.confirm('Disconnect from QuickBooks? Your sync data will be preserved.')) return
                    try {
                      await supabase.from('quickbooks_connections')
                        .update({ is_active: false })
                        .eq('user_id', user.id)
                      setQboConnection(null)
                    } catch (err) {
                      alert('Failed to disconnect: ' + err.message)
                    }
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Disconnect
                </button>
              </div>

              <div className="mb-6">
                <h3 className="font-medium mb-3">Sync Settings</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={qboSettings.auto_sync_invoices}
                      onChange={async (e) => {
                        const newSettings = { ...qboSettings, auto_sync_invoices: e.target.checked }
                        setQboSettings(newSettings)
                        await supabase.from('quickbooks_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">Auto-sync invoices</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={qboSettings.auto_sync_expenses}
                      onChange={async (e) => {
                        const newSettings = { ...qboSettings, auto_sync_expenses: e.target.checked }
                        setQboSettings(newSettings)
                        await supabase.from('quickbooks_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">Auto-sync expenses</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={qboSettings.auto_sync_payments}
                      onChange={async (e) => {
                        const newSettings = { ...qboSettings, auto_sync_payments: e.target.checked }
                        setQboSettings(newSettings)
                        await supabase.from('quickbooks_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">Auto-sync payments</span>
                  </label>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium">Account Mappings</h3>
                  <button
                    onClick={async () => {
                      setLoadingAccounts(true)
                      try {
                        const { data } = await supabase.functions.invoke('qbo-get-accounts', {
                          body: { userId: user.id }
                        })
                        if (data) setQboAccounts(data)
                      } catch (err) {
                        alert('Failed to refresh accounts')
                      }
                      setLoadingAccounts(false)
                    }}
                    disabled={loadingAccounts}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {loadingAccounts ? 'Loading...' : 'Refresh accounts'}
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Income Account (for invoices)</label>
                    <select
                      value={qboSettings.income_account_id || ''}
                      onChange={async (e) => {
                        const selected = qboAccounts.income.find(a => a.id === e.target.value)
                        const newSettings = { ...qboSettings, income_account_id: e.target.value, income_account_name: selected?.name || '' }
                        setQboSettings(newSettings)
                        await supabase.from('quickbooks_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">Select income account...</option>
                      {qboAccounts.income.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Bank Account (for payments)</label>
                    <select
                      value={qboSettings.bank_account_id || ''}
                      onChange={async (e) => {
                        const selected = qboAccounts.bank.find(a => a.id === e.target.value)
                        const newSettings = { ...qboSettings, bank_account_id: e.target.value, bank_account_name: selected?.name || '' }
                        setQboSettings(newSettings)
                        await supabase.from('quickbooks_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                      }}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">Select bank account...</option>
                      {qboAccounts.bank.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Expense Account Mappings</label>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(qboSettings.expense_account_mappings || {}).map(([category, mapping]) => (
                        <div key={category} className="flex items-center gap-2">
                          <span className="w-20 text-sm capitalize text-gray-600">{category}</span>
                          <select
                            value={mapping.id || ''}
                            onChange={async (e) => {
                              const selected = qboAccounts.expense.find(a => a.id === e.target.value)
                              const newMappings = { ...qboSettings.expense_account_mappings, [category]: { id: e.target.value, name: selected?.name || mapping.name } }
                              const newSettings = { ...qboSettings, expense_account_mappings: newMappings }
                              setQboSettings(newSettings)
                              await supabase.from('quickbooks_sync_settings').upsert({ ...newSettings, user_id: user.id }, { onConflict: 'user_id' })
                            }}
                            className="flex-1 px-2 py-1 border rounded text-sm"
                          >
                            <option value="">-</option>
                            {qboAccounts.expense.map(acc => (
                              <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium">Sync Log</h3>
                  <select
                    value={qboLogFilter}
                    onChange={(e) => setQboLogFilter(e.target.value)}
                    className="px-2 py-1 border rounded text-sm"
                  >
                    <option value="all">All</option>
                    <option value="success">Success</option>
                    <option value="error">Errors</option>
                  </select>
                </div>
                <div className="max-h-64 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Entity</th>
                        <th className="text-left px-3 py-2">Direction</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {qboSyncLog.filter(l => qboLogFilter === 'all' || l.status === qboLogFilter).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-gray-500">No sync history</td>
                        </tr>
                      ) : (
                        qboSyncLog.filter(l => qboLogFilter === 'all' || l.status === qboLogFilter).slice(0, 20).map((log) => (
                          <tr key={log.id} className="border-t">
                            <td className="px-3 py-2">{log.entity_type}</td>
                            <td className="px-3 py-2">{log.direction === 'to_qbo' ? '→ QBO' : '← QBO'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs ${log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            <td className="px-3 py-2">
                              {log.status === 'error' && (
                                <button
                                  onClick={async () => {
                                    try {
                                      if (log.entity_type === 'invoice') {
                                        await supabase.functions.invoke('qbo-sync-invoice', { body: { invoiceId: log.entity_id, userId: user.id } })
                                      } else if (log.entity_type === 'customer') {
                                        await supabase.functions.invoke('qbo-sync-customer', { body: { customerId: log.entity_id, userId: user.id } })
                                      } else if (log.entity_type === 'expense') {
                                        await supabase.functions.invoke('qbo-sync-expense', { body: { expenseId: log.entity_id, userId: user.id } })
                                      }
                                      loadSettings()
                                    } catch (err) { alert(err.message) }
                                  }}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Retry
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!canEdit && (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-500">You don't have access to settings.</p>
        </div>
      )}
    </div>
  )
}