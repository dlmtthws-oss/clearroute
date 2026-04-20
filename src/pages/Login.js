import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [loginAs, setLoginAs] = useState('admin')
  const [workers, setWorkers] = useState([])
  const [selectedWorker, setSelectedWorker] = useState('')

  useEffect(() => {
    loadWorkers()
  }, [])

  async function loadWorkers() {
    const { data } = await supabase
      .from('workers')
      .select('id, name, email, role')
      .eq('is_active', true)
      .order('name')
    setWorkers(data || [])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (loginAs === 'worker') {
        const worker = workers.find(w => w.id === selectedWorker)
        if (!worker) {
          setError('Please select a worker')
          setLoading(false)
          return
        }
        if (onLogin) onLogin({ ...worker, is_worker: true, role: 'worker' })
      } else if (isRegister) {
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              role: loginAs
            }
          }
        })
        if (error) throw error
        alert('Check your email for confirmation link!')
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single()
        
        if (onLogin) onLogin({ 
          ...data.user, 
          ...profile,
          is_admin: true, 
          role: profile?.role || 'admin'
        })
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)'}}>
      <div className="w-full max-w-md p-8" style={{background: 'white', borderRadius: '24px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)'}}>
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center" style={{background: 'linear-gradient(135deg, #3b82f6, #2563eb)', borderRadius: '16px'}}>
            <span className="text-3xl">🪟</span>
          </div>
          <h1 className="text-2xl font-bold" style={{color: '#0f172a'}}>ClearRoute</h1>
          <p className="text-gray-500 mt-2">Window Cleaning Business Management</p>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => setLoginAs('admin')}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              loginAs === 'admin' ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={{background: loginAs === 'admin' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : undefined}}
          >
            Admin / Manager
          </button>
          <button
            type="button"
            onClick={() => setLoginAs('worker')}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              loginAs === 'worker' ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={{background: loginAs === 'worker' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : undefined}}
          >
            Field Worker
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {loginAs === 'worker' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Worker</label>
              <select
                value={selectedWorker}
                onChange={e => setSelectedWorker(e.target.value)}
                className="input"
                required
              >
                <option value="">Choose a worker...</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {workers.length === 0 && (
                <p className="text-xs text-orange-600 mt-1">No workers found. Ask admin to add workers.</p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  placeholder="you@example.com"
                  required={loginAs === 'admin'}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                  required={loginAs === 'admin'}
                  minLength={6}
                />
              </div>
            </>
          )}

          {error && (
            <div className="p-3 rounded-lg" style={{background: '#fef2f2', color: '#dc2626', fontSize: '14px'}}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (loginAs === 'worker' && !selectedWorker)}
            className="btn btn-primary w-full"
          >
            {loading ? 'Please wait...' : loginAs === 'worker' ? 'Enter as Worker' : (isRegister ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        {loginAs === 'admin' && (
          <div className="mt-6 text-center">
            <button
              onClick={() => setIsRegister(!isRegister)}
              className="text-sm"
              style={{color: '#3b82f6'}}
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        )}

        <div className="mt-6 p-4 rounded-lg" style={{background: '#f8fafc'}}>
          <p className="text-xs text-gray-500 text-center mb-3">Quick Demo Login</p>
          <div className="space-y-2">
            <button
              onClick={() => onLogin({ id: 'admin-1', email: 'admin@clearroute.co.uk', name: 'Admin User', is_admin: true, role: 'admin', full_name: 'Admin User' })}
              className="btn btn-secondary w-full"
            >
              Continue as Admin
            </button>
            <button
              onClick={() => onLogin({ id: 'manager-1', email: 'manager@clearroute.co.uk', name: 'Manager User', is_admin: true, role: 'manager', full_name: 'Manager User' })}
              className="btn btn-secondary w-full"
            >
              Continue as Manager
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
