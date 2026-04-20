import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { logAuditEvent, AUDIT_ACTIONS } from '../lib/auditLog'

export default function Workers() {
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingWorker, setEditingWorker] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'worker'
  })

  useEffect(() => {
    loadWorkers()
  }, [])

  async function loadWorkers() {
    setLoading(true)
    const { data } = await supabase
      .from('workers')
      .select('*')
      .order('name')
    setWorkers(data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!formData.name || !formData.email) return

    if (editingWorker) {
      const oldWorker = workers.find(w => w.id === editingWorker)
      await supabase
        .from('workers')
        .update(formData)
        .eq('id', editingWorker)
      
      logAuditEvent(
        AUDIT_ACTIONS.USER_ROLE_CHANGED,
        'user',
        editingWorker,
        formData.name,
        { role: oldWorker?.role },
        { role: formData.role }
      )
    } else {
      const { data } = await supabase
        .from('workers')
        .insert([formData])
        .select()
      
      logAuditEvent(
        AUDIT_ACTIONS.USER_INVITED,
        'user',
        data?.[0]?.id,
        formData.name,
        null,
        formData
      )
    }

    setFormData({ name: '', email: '', phone: '', role: 'worker' })
    setEditingWorker(null)
    setShowForm(false)
    loadWorkers()
  }

  async function handleDelete(id) {
    // eslint-disable-next-line no-restricted-globals
    if (!window.confirm('Are you sure you want to delete this worker?')) return
    
    const worker = workers.find(w => w.id === id)
    await supabase
      .from('workers')
      .delete()
      .eq('id', id)
    loadWorkers()
    
    logAuditEvent(
      AUDIT_ACTIONS.USER_DEACTIVATED,
      'user',
      id,
      worker?.name,
      worker,
      null
    )
  }

  async function toggleActive(id, isActive) {
    const worker = workers.find(w => w.id === id)
    await supabase
      .from('workers')
      .update({ is_active: !isActive })
      .eq('id', id)
    loadWorkers()
    
    logAuditEvent(
      AUDIT_ACTIONS.USER_DEACTIVATED,
      'user',
      id,
      worker?.name,
      { is_active: isActive },
      { is_active: !isActive }
    )
  }

  function handleEdit(worker) {
    setEditingWorker(worker.id)
    setFormData({
      name: worker.name,
      email: worker.email,
      phone: worker.phone || '',
      role: worker.role
    })
    setShowForm(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Workers</h1>
          <p className="page-subtitle">Manage your team</p>
        </div>
        <button onClick={() => {
          setEditingWorker(null)
          setFormData({ name: '', email: '', phone: '', role: 'worker' })
          setShowForm(!showForm)
        }} className="btn btn-primary">
          {showForm ? 'Cancel' : '+ Add Worker'}
        </button>
      </div>

      {showForm && (
        <div className="card-static p-6 mb-6">
          <h3 className="font-medium mb-4">
            {editingWorker ? 'Edit Worker' : 'Add New Worker'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="input"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="input"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                className="input"
                placeholder="07123456789"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select
                value={formData.role}
                onChange={e => setFormData({...formData, role: e.target.value})}
                className="input"
              >
                <option value="worker">Worker</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <button onClick={handleSave} className="btn btn-primary mt-4">
            {editingWorker ? 'Update Worker' : 'Add Worker'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <p className="stat-label">Total Workers</p>
          <p className="stat-value" style={{color: '#3b82f6'}}>{workers.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Active</p>
          <p className="stat-value" style={{color: '#22c55e'}}>{workers.filter(w => w.is_active).length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Inactive</p>
          <p className="stat-value" style={{color: '#9ca3af'}}>{workers.filter(w => !w.is_active).length}</p>
        </div>
      </div>

      <div className="card-static overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8">Loading...</td>
              </tr>
            ) : workers.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">
                  No workers yet. Add your first worker.
                </td>
              </tr>
            ) : workers.map(worker => (
              <tr key={worker.id}>
                <td className="font-medium">{worker.name}</td>
                <td className="text-gray-600">{worker.email}</td>
                <td className="text-gray-600">{worker.phone || '-'}</td>
                <td>
                  <span className={`badge ${
                    worker.role === 'admin' ? 'badge-danger' : 
                    worker.role === 'supervisor' ? 'badge-info' : 'badge-warning'
                  }`}>
                    {worker.role}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => toggleActive(worker.id, worker.is_active)}
                    className={`text-xs px-2 py-1 rounded ${
                      worker.is_active 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {worker.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(worker)}
                      className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(worker.id)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}