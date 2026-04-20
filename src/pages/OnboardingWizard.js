import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TOTAL_STEPS = 6

export default function OnboardingWizard({ user, onComplete }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState({
    customerCreated: false,
    routeCreated: false,
    teamInvited: 0
  })

  const [companySettings, setCompanySettings] = useState({
    company_name: '',
    address_line_1: '',
    city: '',
    postcode: '',
    phone: '',
    email: '',
    vat_number: '',
    logo_url: '',
    primary_colour: '#2563EB'
  })

  const [customer, setCustomer] = useState({
    name: '',
    address_line_1: '',
    postcode: '',
    phone: '',
    email: '',
    service_type: 'one_off'
  })

  const [route, setRoute] = useState({
    name: '',
    scheduled_date: new Date().toISOString().split('T')[0]
  })

  const [paymentMethod, setPaymentMethod] = useState('manual')
  const [paymentTerms, setPaymentTerms] = useState(30)

  const [teamMembers, setTeamMembers] = useState([
    { name: '', email: '', role: 'worker' }
  ])

  useEffect(() => {
    loadSavedProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSavedProgress() {
    const { data: settings } = await supabase
      .from('company_settings')
      .select('onboarding_step, onboarding_completed')
      .limit(1)
      .single()

    if (settings?.onboarding_step > 0) {
      setStep(settings.onboarding_step)
    }

    if (settings?.onboarding_completed) {
      navigate('/')
    }
  }

  async function saveProgress(currentStep) {
    await supabase
      .from('company_settings')
      .upsert({
        onboarding_step: currentStep,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })
  }

  async function handleNext() {
    setLoading(true)

    try {
      if (step === 2) {
        await supabase
          .from('company_settings')
          .upsert({ ...companySettings, updated_at: new Date().toISOString() })
      }

      if (step === 3 && customer.name) {
        const { data: customerData } = await supabase
          .from('customers')
          .insert([{
            name: customer.name,
            address_line_1: customer.address_line_1,
            postcode: customer.postcode,
            phone: customer.phone || null,
            email: customer.email || null,
            service_type: customer.service_type || 'one_off'
          }])
          .select()
          .single()

        if (customerData) {
          setSummary(s => ({ ...s, customerCreated: true, firstCustomerId: customerData.id }))
        }
      }

      if (step === 4 && route.name) {
        const stopData = summary.firstCustomerId ? [{
          customer_id: summary.firstCustomerId,
          stop_number: 1,
          estimated_minutes: 30
        }] : []

        const { data: routeData } = await supabase
          .from('routes')
          .insert([{
            name: route.name,
            scheduled_date: route.scheduled_date,
            status: 'scheduled'
          }])
          .select()
          .single()

        if (routeData && stopData.length > 0) {
          await supabase
            .from('route_stops')
            .insert(stopData.map(s => ({ ...s, route_id: routeData.id })))
        }

        if (routeData) {
          setSummary(s => ({ ...s, routeCreated: true }))
        }
      }

      if (step === 5) {
        await supabase
          .from('company_settings')
          .upsert({
            default_payment_terms: paymentTerms,
            payment_method: paymentMethod,
            updated_at: new Date().toISOString()
          })
      }

      if (step === 6 && teamMembers.length > 0) {
        const validMembers = teamMembers.filter(m => m.name && m.email)
        for (const member of validMembers) {
          const { data: profile } = await supabase
            .from('profiles')
            .insert([{
              full_name: member.name,
              email: member.email,
              role: member.role,
              status: 'invited'
            }])
            .select()
            .single()

          if (profile) {
            setSummary(s => ({ ...s, teamInvited: s.teamInvited + 1 }))
          }
        }
      }

      if (step < TOTAL_STEPS) {
        setStep(step + 1)
        await saveProgress(step + 1)
      } else {
        await completeOnboarding()
      }
    } catch (err) {
      console.error('Onboarding error:', err)
    }

    setLoading(false)
  }

  async function completeOnboarding() {
    await supabase
      .from('company_settings')
      .upsert({
        onboarding_completed: true,
        onboarding_step: TOTAL_STEPS,
        updated_at: new Date().toISOString()
      })

    if (onComplete) {
      onComplete()
    }
    navigate('/')
  }

  async function handleSkip() {
    await supabase
      .from('company_settings')
      .upsert({
        onboarding_completed: true,
        onboarding_step: 0,
        updated_at: new Date().toISOString()
      })

    navigate('/')
  }

  function addTeamMember() {
    setTeamMembers([...teamMembers, { name: '', email: '', role: 'worker' }])
  }

  function updateTeamMember(index, field, value) {
    const updated = [...teamMembers]
    updated[index][field] = value
    setTeamMembers(updated)
  }

  function removeTeamMember(index) {
    setTeamMembers(teamMembers.filter((_, i) => i !== index))
  }

  const progressPercent = ((step - 1) / TOTAL_STEPS) * 100

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Progress Bar */}
      <div className="bg-white/10 backdrop-blur-sm border-b border-white/20">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <span className="text-xl">🪟</span>
            </div>
            <div>
              <p className="text-white font-semibold">ClearRoute</p>
              <p className="text-white/60 text-sm">Step {step} of {TOTAL_STEPS}</p>
            </div>
          </div>
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="text-white/80 hover:text-white text-sm"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="max-w-2xl mx-auto">
          <div className="h-1 bg-white/20">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {step === 1 && (
          <div className="text-center">
            <div className="w-20 h-20 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">👋</span>
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">Welcome to ClearRoute</h1>
            <p className="text-xl text-white/80 mb-8">Let's get your business set up. This takes about 5 minutes.</p>
            
            <div className="text-left bg-white/10 rounded-xl p-6 mb-8 max-w-md mx-auto">
              <p className="text-white/60 mb-4">What you'll set up:</p>
              <ul className="space-y-3">
                {['Your company details', 'Your first customer', 'Your first route', 'Payment settings', 'Your team'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-white">
                    <span className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-sm">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={handleNext}
              disabled={loading}
              className="px-8 py-4 bg-blue-500 text-white rounded-xl font-semibold text-lg hover:bg-blue-600 transition-colors"
            >
              Get Started
            </button>

            <button
              onClick={handleSkip}
              className="block mx-auto mt-6 text-white/60 hover:text-white text-sm"
            >
              Skip setup, go to dashboard
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Tell us about your business</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company name *</label>
                <input
                  type="text"
                  value={companySettings.company_name}
                  onChange={e => setCompanySettings({ ...companySettings, company_name: e.target.value })}
                  className="input"
                  placeholder="Your Business Ltd"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <input
                  type="text"
                  value={companySettings.address_line_1}
                  onChange={e => setCompanySettings({ ...companySettings, address_line_1: e.target.value })}
                  className="input"
                  placeholder="123 High Street"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                  <input
                    type="text"
                    value={companySettings.city}
                    onChange={e => setCompanySettings({ ...companySettings, city: e.target.value })}
                    className="input"
                    placeholder="London"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Postcode *</label>
                  <input
                    type="text"
                    value={companySettings.postcode}
                    onChange={e => setCompanySettings({ ...companySettings, postcode: e.target.value })}
                    className="input"
                    placeholder="SW1A 1AA"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={companySettings.phone}
                    onChange={e => setCompanySettings({ ...companySettings, phone: e.target.value })}
                    className="input"
                    placeholder="01234 567890"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    value={companySettings.email}
                    onChange={e => setCompanySettings({ ...companySettings, email: e.target.value })}
                    className="input"
                    placeholder="info@company.co.uk"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label>
                <input
                  type="text"
                  value={companySettings.vat_number}
                  onChange={e => setCompanySettings({ ...companySettings, vat_number: e.target.value })}
                  className="input"
                  placeholder="GB123456789"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary Colour</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={companySettings.primary_colour}
                    onChange={e => setCompanySettings({ ...companySettings, primary_colour: e.target.value })}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={companySettings.primary_colour}
                    onChange={e => setCompanySettings({ ...companySettings, primary_colour: e.target.value })}
                    className="input flex-1"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleNext}
              disabled={loading || !companySettings.company_name || !companySettings.address_line_1 || !companySettings.city || !companySettings.postcode || !companySettings.email}
              className="btn btn-primary w-full mt-6"
            >
              {loading ? 'Saving...' : 'Next'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Add your first customer</h2>
            <p className="text-gray-600 mb-6">You can import all your customers later — let's just add one to get started.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer name *</label>
                <input
                  type="text"
                  value={customer.name}
                  onChange={e => setCustomer({ ...customer, name: e.target.value })}
                  className="input"
                  placeholder="Acme Corporation"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <input
                  type="text"
                  value={customer.address_line_1}
                  onChange={e => setCustomer({ ...customer, address_line_1: e.target.value })}
                  className="input"
                  placeholder="456 Business Park"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Postcode *</label>
                <input
                  type="text"
                  value={customer.postcode}
                  onChange={e => setCustomer({ ...customer, postcode: e.target.value })}
                  className="input"
                  placeholder="M1 1AA"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={customer.phone}
                    onChange={e => setCustomer({ ...customer, phone: e.target.value })}
                    className="input"
                    placeholder="01234 567890"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={customer.email}
                    onChange={e => setCustomer({ ...customer, email: e.target.value })}
                    className="input"
                    placeholder="customer@company.co.uk"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service type</label>
                <select
                  value={customer.service_type}
                  onChange={e => setCustomer({ ...customer, service_type: e.target.value })}
                  className="input"
                >
                  <option value="one_off">One-off clean</option>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-4">You can import all your existing customers from a spreadsheet after setup.</p>

            <button
              onClick={handleNext}
              disabled={loading}
              className="btn btn-primary w-full mt-6"
            >
              {loading ? 'Saving...' : customer.name ? 'Add Customer & Continue' : 'Skip this step'}
            </button>

            {!customer.name && (
              <button
                onClick={handleNext}
                className="block w-full text-center mt-3 text-gray-500 hover:text-gray-700 text-sm"
              >
                Skip this step
              </button>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="bg-white rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Create your first route</h2>
            <p className="text-gray-600 mb-6">A route is a list of customers your team visits in one day.</p>
            
            {summary.customerCreated && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                <p className="text-green-700 flex items-center gap-2">
                  <span>✓</span>
                  We've added <strong>{customer.name}</strong> as your first stop
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Route name *</label>
                <input
                  type="text"
                  value={route.name}
                  onChange={e => setRoute({ ...route, name: e.target.value })}
                  className="input"
                  placeholder="Monday Round"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled date *</label>
                <input
                  type="date"
                  value={route.scheduled_date}
                  onChange={e => setRoute({ ...route, scheduled_date: e.target.value })}
                  className="input"
                  required
                />
              </div>
            </div>

            <button
              onClick={handleNext}
              disabled={loading}
              className="btn btn-primary w-full mt-6"
            >
              {loading ? 'Saving...' : route.name ? 'Create Route & Continue' : 'Skip this step'}
            </button>

            {!route.name && (
              <button
                onClick={handleNext}
                className="block w-full text-center mt-3 text-gray-500 hover:text-gray-700 text-sm"
              >
                Skip this step
              </button>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="bg-white rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">How do your customers pay you?</h2>
            
            <div className="space-y-3 mb-6">
              <button
                onClick={() => setPaymentMethod('gocardless')}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  paymentMethod === 'gocardless' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Direct Debit (GoCardless)</p>
                    <p className="text-sm text-gray-500">Collect payments automatically</p>
                  </div>
                  {paymentMethod === 'gocardless' && (
                    <span className="text-green-500 text-xl">✓</span>
                  )}
                </div>
              </button>

              <button
                onClick={() => setPaymentMethod('manual')}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  paymentMethod === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Bank Transfer / Manual</p>
                    <p className="text-sm text-gray-500">I'll track payments manually</p>
                  </div>
                  {paymentMethod === 'manual' && (
                    <span className="text-green-500 text-xl">✓</span>
                  )}
                </div>
              </button>

              <button
                onClick={() => setPaymentMethod('both')}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  paymentMethod === 'both' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Both</p>
                    <p className="text-sm text-gray-500">Some direct debit, some manual</p>
                  </div>
                  {paymentMethod === 'both' && (
                    <span className="text-green-500 text-xl">✓</span>
                  )}
                </div>
              </button>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Default payment terms</label>
              <select
                value={paymentTerms}
                onChange={e => setPaymentTerms(Number(e.target.value))}
                className="input"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>

            <button
              onClick={handleNext}
              disabled={loading}
              className="btn btn-primary w-full"
            >
              {loading ? 'Saving...' : 'Continue'}
            </button>
          </div>
        )}

        {step === 6 && (
          <div className="bg-white rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Invite your team</h2>
            <p className="text-gray-600 mb-6">Invite team members so they can access their routes on their phones.</p>
            
            <div className="space-y-4 mb-6">
              {teamMembers.map((member, index) => (
                <div key={index} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-600">Team Member {index + 1}</span>
                    {teamMembers.length > 1 && (
                      <button
                        onClick={() => removeTeamMember(index)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={member.name}
                      onChange={e => updateTeamMember(index, 'name', e.target.value)}
                      className="input"
                      placeholder="Name"
                    />
                    <input
                      type="email"
                      value={member.email}
                      onChange={e => updateTeamMember(index, 'email', e.target.value)}
                      className="input"
                      placeholder="Email"
                    />
                    <select
                      value={member.role}
                      onChange={e => updateTeamMember(index, 'role', e.target.value)}
                      className="input"
                    >
                      <option value="worker">Field Worker</option>
                      <option value="manager">Manager</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addTeamMember}
              className="text-blue-600 hover:text-blue-700 text-sm mb-6"
            >
              + Add Another
            </button>

            <button
              onClick={handleNext}
              disabled={loading}
              className="btn btn-primary w-full"
            >
              {loading ? 'Sending...' : 'Send Invites & Finish'}
            </button>

            <button
              onClick={handleNext}
              className="block w-full text-center mt-3 text-gray-500 hover:text-gray-700 text-sm"
            >
              Skip, I'll add team members later
            </button>
          </div>
        )}
      </div>
    </div>
  )
}