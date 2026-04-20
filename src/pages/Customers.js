import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ExportButton from '../components/ExportButton';
import { exportToCSV, exportToExcel, CUSTOMER_COLUMNS, formatExportFilename } from '../lib/exportUtils';
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog';
import { SkeletonTable } from '../components/SkeletonComponents';
import { EmptyStateCustomers } from '../components/EmptyStates';
import { searchCompaniesHouse, validateVATNumber, formatAddressForCustomer } from '../lib/lookups';

function PaymentMethodBadge({ method, gcMandate }) {
  if (method === 'direct_debit' && gcMandate) {
    return (
      <span className={`text-xs px-2 py-1 rounded ${gcMandate.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
        DD {gcMandate.status}
      </span>
    )
  }
  return <span className="text-gray-400 text-xs">Manual</span>
}

async function loadCustomerMandate(customerId) {
  if (!customerId) return null
  const { data } = await supabase
    .from('gocardless_mandates')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', ['active', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data
}

function AddressAutocomplete({ value, onChange, placeholder = 'Start typing address...' }) {
  const [predictions, setPredictions] = useState([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowPredictions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = useCallback(async (inputValue) => {
    onChange(inputValue);
    if (!inputValue || inputValue.length < 3 || !apiKey) {
      setPredictions([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(inputValue)}&types=address&components=country:gb&key=${apiKey}`
      );
      const data = await response.json();
      setPredictions(data.predictions || []);
    } catch (err) {
      console.error('Autocomplete error:', err);
    }
    setLoading(false);
  }, [apiKey, onChange]);

  const handleSelect = (prediction) => {
    const fillInAddress = async () => {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=address_components&key=${apiKey}`
        );
        const data = await response.json();
        if (data.result?.address_components) {
          const components = data.result.address_components;
          const getPart = (types) => {
            const part = components.find(c => types.some(t => c.types.includes(t)));
            return part?.long_name || '';
          };
          const address = {
            address_line_1: [getPart(['street_number']), getPart(['route'])].filter(Boolean).join(' '),
            city: getPart(['locality', 'administrative_area_level_2']),
            postcode: getPart(['postal_code']),
          };
          const fullAddress = `${address.address_line_1}, ${address.city}, ${address.postcode}`;
          onChange(fullAddress);
          onChange({ target: { value: address.address_line_1, name: 'address_line_1' } });
          onChange({ target: { value: address.city, name: 'city' } });
          onChange({ target: { value: address.postcode, name: 'postcode' } });
        }
      } catch (err) {
        onChange(prediction.description);
      }
    };
    fillInAddress();
    setShowPredictions(false);
  };

  const handleChangeWrapper = (e) => {
    handleInputChange(e.target.value);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChangeWrapper}
        onFocus={() => predictions.length > 0 && setShowPredictions(true)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        placeholder={placeholder}
      />
      {showPredictions && predictions.length > 0 && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {predictions.map((pred) => (
            <li
              key={pred.place_id}
              onClick={() => handleSelect(pred)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              {pred.description}
            </li>
          ))}
        </ul>
      )}
      {loading && <div className="absolute right-3 top-2 text-xs text-gray-400">Loading...</div>}
    </div>
  );
}

export default function Customers({ user }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ 
    name: '', address_line_1: '', city: '', postcode: '', email: '', phone: '', 
    service_type: 'Residential', price: '', regularity: '4weekly',
    company_number: '', is_business: false, vat_number: '',
    registered_address_line_1: '', registered_address_line_2: '', registered_city: '', registered_postcode: ''
  });
  const [saving, setSaving] = useState(false);
  
  // Companies House lookup
  const [companySearch, setCompanySearch] = useState('');
  const [companyResults, setCompanyResults] = useState([]);
  const [searchingCompanies, setSearchingCompanies] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  
  // VAT validation
  const [validatingVat, setValidatingVat] = useState(false);
  const [vatValidation, setVatValidation] = useState(null);

  useEffect(() => {
    loadCustomers();
  }, []);

  async function loadCustomers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, address_line_1, city, postcode, email, phone, portal_token, portal_enabled, company_number, is_business, vat_number, vat_validated, xero_contact_id, xero_synced_at, qbo_customer_id, qbo_synced_at')
      .order('name');
    if (error) setError(error.message);
    else setCustomers(data || []);
    setLoading(false);
  }

  const handleCompanySearch = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setCompanyResults([]);
      return;
    }
    
    setSearchingCompanies(true);
    try {
      const result = await searchCompaniesHouse(query);
      setCompanyResults(result.results || []);
    } catch (err) {
      console.error('Search error:', err);
      setCompanyResults([]);
    } finally {
      setSearchingCompanies(false);
    }
  }, []);

  const handleSelectCompany = (company) => {
    setSelectedCompany(company);
    const address = formatAddressForCustomer(company.registered_office_address);
    setNewCustomer(prev => ({
      ...prev,
      name: company.company_name,
      address_line_1: address.address_line_1,
      address_line_2: address.address_line_2,
      city: address.city,
      postcode: address.postcode,
      company_number: company.company_number,
      is_business: true,
      registered_address_line_1: address.address_line_1,
      registered_address_line_2: address.address_line_2,
      registered_city: address.city,
      registered_postcode: address.postcode
    }));
    setCompanySearch('');
    setCompanyResults([]);
  };

  const handleValidateVat = async () => {
    if (!newCustomer.vat_number) return;
    
    setValidatingVat(true);
    try {
      const result = await validateVATNumber(newCustomer.vat_number);
      setVatValidation(result);
    } catch (err) {
      setVatValidation({ valid: null, error: err.message });
    } finally {
      setValidatingVat(false);
    }
  };

  const canEdit = user?.role === 'admin'

  const handleExportCSV = () => {
    const exportData = filtered.map(c => ({
      ...c,
      total_invoiced_lifetime: 0,
      total_paid_lifetime: 0,
      outstanding_balance: 0
    }))
    exportToCSV(exportData, formatExportFilename('Customers'), CUSTOMER_COLUMNS)
  }

  const handleExportExcel = () => {
    const exportData = filtered.map(c => ({
      ...c,
      total_invoiced_lifetime: 0,
      total_paid_lifetime: 0,
      outstanding_balance: 0
    }))
    exportToExcel(exportData, formatExportFilename('Customers'), CUSTOMER_COLUMNS, 'Customers')
  }

  const handleRegeneratePortalLink = async (customerId) => {
    if (!window.confirm('This will invalidate the existing link. The customer will need the new link to access their portal. Continue?')) {
      return
    }
    
    const customer = customers.find(c => c.id === customerId)
    const newToken = crypto.randomUUID()
    await supabase
      .from('customers')
      .update({ portal_token: newToken })
      .eq('id', customerId)
    
    loadCustomers()
    
    logAuditEvent(
      AUDIT_ACTIONS.CUSTOMER_PORTAL_LINK_REGENERATED,
      'customer',
      customerId,
      customer?.name,
      { portal_token: 'existing' },
      { portal_token: 'new' }
    )
  }

  const handleTogglePortal = async (customer) => {
    await supabase
      .from('customers')
      .update({ portal_enabled: !customer.portal_enabled })
      .eq('id', customer.id)
    
    loadCustomers()
    
    logAuditEvent(
      AUDIT_ACTIONS.CUSTOMER_UPDATED,
      'customer',
      customer.id,
      customer.name,
      { portal_enabled: customer.portal_enabled },
      { portal_enabled: !customer.portal_enabled }
    )
  }

  const handleCopyPortalLink = (token) => {
    const url = `${window.location.origin}/portal/${token}`
    navigator.clipboard.writeText(url)
    alert('Portal link copied to clipboard!')
  }

  const handleSendPortalLink = async (customer) => {
    if (!customer.email) {
      alert('Customer has no email address')
      return
    }
    
    const portalLink = `${window.location.origin}/portal/${customer.portal_token}`
    alert(`Portal link: ${portalLink}\n\n(In production, this would send an email to ${customer.email})`)
  }

  async function handleSave() {
    if (!newCustomer.name) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    
    // Generate portal token for new customer
    const customerData = {
      name: newCustomer.name,
      address_line_1: newCustomer.address_line_1,
      city: newCustomer.city,
      postcode: newCustomer.postcode,
      email: newCustomer.email,
      phone: newCustomer.phone,
      service_type: newCustomer.service_type,
      price: newCustomer.price || null,
      regularity: newCustomer.regularity,
      portal_token: crypto.randomUUID(),
      company_number: newCustomer.company_number || null,
      is_business: newCustomer.is_business || false,
      vat_number: newCustomer.vat_number || null,
      vat_validated: vatValidation?.valid || null,
      vat_validated_at: vatValidation?.valid ? new Date().toISOString() : null,
      registered_address_line_1: newCustomer.registered_address_line_1 || null,
      registered_address_line_2: newCustomer.registered_address_line_2 || null,
      registered_city: newCustomer.registered_city || null,
      registered_postcode: newCustomer.registered_postcode || null,
    }
    
    const { data, error } = await supabase
      .from('customers')
      .insert([customerData])
      .select();
    if (error) {
      setError(error.message);
    } else {
      setCustomers([...customers, data[0]]);
      setNewCustomer({ name: '', address_line_1: '', city: '', postcode: '', email: '', phone: '', service_type: 'Residential', price: '', regularity: '4weekly', company_number: '', is_business: false, vat_number: '', registered_address_line_1: '', registered_address_line_2: '', registered_city: '', registered_postcode: '' });
      setShowAddForm(false);
      setSelectedCompany(null);
      setVatValidation(null);
      
      logAuditEvent(
        AUDIT_ACTIONS.CUSTOMER_CREATED,
        'customer',
        data[0].id,
        data[0].name,
        null,
        customerData
      );
    }
    setSaving(false);
  }

  const filtered = customers.filter(c => {
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.postcode?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-1">{customers.length} total</p>
        </div>
        <div className="flex gap-3">
          <ExportButton
            onExportCSV={handleExportCSV}
            onExportExcel={handleExportExcel}
            filename={formatExportFilename('Customers')}
            rowCount={filtered.length}
          />
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {showAddForm ? 'Cancel' : 'Add Customer'}
          </button>
          <Link
            to="/customers/import/history"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Import History
          </Link>
          <Link
            to="/customers/import"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Import
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, email or postcode..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
          <h3 className="text-lg font-medium mb-4">Add New Customer</h3>
          
          {/* Companies House Lookup */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-sm mb-3">Companies House Lookup</h4>
            <div className="relative">
              <input
                type="text"
                value={companySearch}
                onChange={e => {
                  setCompanySearch(e.target.value);
                  if (e.target.value.length >= 2) {
                    handleCompanySearch(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm pr-10"
                placeholder="Search by company name or number..."
              />
              {searchingCompanies && (
                <div className="absolute right-3 top-2">
                  <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
              )}
              
              {/* Results dropdown */}
              {companyResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                  {companyResults.map((company) => (
                    <button
                      key={company.company_number}
                      onClick={() => handleSelectCompany(company)}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b last:border-b-0"
                    >
                      <p className="font-medium text-sm">{company.company_name}</p>
                      <p className="text-xs text-gray-500">No: {company.company_number}</p>
                      <p className="text-xs text-gray-400">
                        {company.registered_office_address?.address_line_1}, {company.registered_office_address?.postal_code}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded ${company.company_status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {company.company_status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">Only showing active companies</p>
            
            {selectedCompany && (
              <div className="mt-3 flex items-center gap-2 text-green-600 text-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Company details filled from Companies House
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={newCustomer.name}
                onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Customer name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Service Type</label>
              <input
                type="text"
                value={newCustomer.service_type}
                onChange={e => setNewCustomer({...newCustomer, service_type: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="e.g. Residential, Commercial"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <AddressAutocomplete
                value={newCustomer.address_line_1}
                onChange={(val) => {
                  if (typeof val === 'object' && val.target) {
                    setNewCustomer({...newCustomer, [val.target.name]: val.target.value});
                  } else {
                    setNewCustomer({...newCustomer, address_line_1: val});
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                value={newCustomer.city}
                onChange={e => setNewCustomer({...newCustomer, city: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Postcode</label>
              <input
                type="text"
                value={newCustomer.postcode}
                onChange={e => setNewCustomer({...newCustomer, postcode: e.target.value.toUpperCase()})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="e.g. M1 1AA"
              />
            </div>
            <div className="md:row-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Customer</label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newCustomer.is_business}
                  onChange={e => setNewCustomer({...newCustomer, is_business: e.target.checked})}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-600">This is a business (enable VAT)</span>
              </div>
            </div>
            {newCustomer.is_business && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCustomer.vat_number}
                      onChange={e => {
                        setNewCustomer({...newCustomer, vat_number: e.target.value.toUpperCase()});
                        setVatValidation(null);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="GB123456789"
                    />
                    <button
                      onClick={handleValidateVat}
                      disabled={validatingVat || !newCustomer.vat_number}
                      className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50"
                    >
                      {validatingVat ? '...' : 'Validate'}
                    </button>
                  </div>
                  {vatValidation && (
                    <div className={`mt-2 text-sm ${vatValidation.valid ? 'text-green-600' : vatValidation.valid === false ? 'text-red-600' : 'text-amber-600'}`}>
                      {vatValidation.valid === true && (
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Valid VAT number
                          {vatValidation.company_name && <span className="ml-2">Registered to: {vatValidation.company_name}</span>}
                        </div>
                      )}
                      {vatValidation.valid === false && (
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Invalid VAT number
                        </div>
                      )}
                      {vatValidation.error && <span>{vatValidation.error}</span>}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Number</label>
                  <input
                    type="text"
                    value={newCustomer.company_number}
                    onChange={e => setNewCustomer({...newCustomer, company_number: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="e.g. 12345678"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={newCustomer.email}
                onChange={e => setNewCustomer({...newCustomer, email: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={newCustomer.phone}
                onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Service Type</label>
              <select
                value={newCustomer.service_type}
                onChange={e => setNewCustomer({...newCustomer, service_type: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price (£)</label>
              <input
                type="number"
                value={newCustomer.price}
                onChange={e => setNewCustomer({...newCustomer, price: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="e.g. 25"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select
                value={newCustomer.regularity}
                onChange={e => setNewCustomer({...newCustomer, regularity: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="4weekly">Every 4 weeks</option>
                <option value="6weekly">Every 6 weeks</option>
                <option value="8weekly">Every 8 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="oneoff">One-off</option>
              </select>
            </div>
          </div>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Customer'}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <SkeletonTable rows={8} />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyStateCustomers 
          hasCustomers={!!search} 
          onClearFilters={() => setSearch('')} 
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Address</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Portal</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600" title="Payment method">Pay</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600" title="Xero sync">
                  <button onClick={() => window.open('https://go.xero.com/', '_blank')} className="hover:text-blue-600">Xero</button>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600" title="QuickBooks sync">
                  <button onClick={() => window.open('https://app.quickbooks.com/', '_blank')} className="hover:text-blue-600">QBO</button>
                </th>
                {canEdit && <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(customer => (
                <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{customer.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {[customer.address_line_1, customer.city, customer.postcode]
                      .filter(Boolean)
                      .join(', ')}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {customer.email ? (
                      <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">
                        {customer.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {customer.phone ? (
                      <a href={`tel:${customer.phone}`} className="hover:underline">
                        {customer.phone}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${customer.portal_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {customer.portal_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {customer.xero_contact_id ? (
                      <button
                        onClick={() => window.open('https://go.xero.com/Contacts/Edit/' + customer.xero_contact_id, '_blank')}
                        className="text-green-600 text-xs hover:underline"
                        title={`Synced ${customer.xero_synced_at ? new Date(customer.xero_synced_at).toLocaleString() : ''}\nClick to view in Xero`}
                      >✓</button>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            const { data } = await supabase.functions.invoke('xero-sync-customer', { body: { customerId: customer.id, userId: user.id } })
                            if (data?.success) loadCustomers()
                            alert(data?.success ? 'Synced!' : data?.error || 'Failed')
                          } catch (err) { alert(err.message) }
                        }}
                        className="text-gray-400 text-xs hover:text-green-600"
                        title="Click to sync to Xero"
                      >-</button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {customer.qbo_customer_id ? (
                      <button
                        onClick={() => window.open('https://app.quickbooks.com/customer/' + customer.qbo_customer_id, '_blank')}
                        className="text-green-600 text-xs hover:underline"
                        title={`Synced ${customer.qbo_synced_at ? new Date(customer.qbo_synced_at).toLocaleString() : ''}\nClick to view in QuickBooks`}
                      >✓</button>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            const { data } = await supabase.functions.invoke('qbo-sync-customer', { body: { customerId: customer.id, userId: user.id } })
                            if (data?.success) loadCustomers()
                            alert(data?.success ? 'Synced!' : data?.error || 'Failed')
                          } catch (err) { alert(err.message) }
                        }}
                        className="text-gray-400 text-xs hover:text-green-600"
                        title="Click to sync to QuickBooks"
                      >-</button>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleCopyPortalLink(customer.portal_token)}
                          className="text-blue-600 text-xs hover:underline"
                          title="Copy portal link"
                        >
                          Copy Link
                        </button>
                        <button
                          onClick={() => handleSendPortalLink(customer)}
                          className="text-gray-600 text-xs hover:underline"
                          title="Send portal link"
                        >
                          Send
                        </button>
                        <button
                          onClick={() => handleRegeneratePortalLink(customer.id)}
                          className="text-amber-600 text-xs hover:underline"
                          title="Regenerate link"
                        >
                          Regenerate
                        </button>
                        <button
                          onClick={() => handleTogglePortal(customer)}
                          className="text-gray-600 text-xs hover:underline"
                          title={customer.portal_enabled ? 'Disable portal' : 'Enable portal'}
                        >
                          {customer.portal_enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
