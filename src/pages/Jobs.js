import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Jobs({ user }) {
  const [jobs, setJobs] = useState([])
  const [routes, setRoutes] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [newJob, setNewJob] = useState({
    customer_id: '',
    route_id: '',
    scheduled_date: '',
    status: 'pending'
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    
    const { data: routeStops } = await supabase
      .from('route_stops')
      .select('*, routes(name, scheduled_date), customers(name, address_line_1, postcode)')
      .order('created_at', { ascending: false })
    
    if (routeStops) {
      const jobsWithCompletions = await Promise.all(
        routeStops.map(async (stop) => {
          const { data: completion } = await supabase
            .from('job_completions')
            .select('*')
            .eq('job_id', stop.id)
            .single()
          
          const { data: photos } = await supabase
            .from('job_photos')
            .select('*')
            .eq('job_id', stop.id)
            .order('created_at', { ascending: false })
          
          return {
            ...stop,
            completion: completion || null,
            photos: photos || []
          }
        })
      )
      setJobs(jobsWithCompletions)
    }

    const { data: routesData } = await supabase
      .from('routes')
      .select('id, name')
      .order('name')
    setRoutes(routesData || [])

    const { data: customersData } = await supabase
      .from('customers')
      .select('id, name, address_line_1, postcode')
      .order('name')
    setCustomers(customersData || [])

    setLoading(false)
  }

  async function handleSave() {
    if (!newJob.customer_id || !newJob.route_id) return
    
    const { data: stop } = await supabase.from('route_stops').insert([{
      route_id: newJob.route_id,
      customer_id: newJob.customer_id,
      estimated_duration: 30,
      stop_order: 1
    }]).select().single()
    
    if (stop) {
      await supabase.from('job_completions').insert([{
        job_id: stop.id,
        status: 'pending'
      }])
    }
    
    setNewJob({ customer_id: '', route_id: '', scheduled_date: '', status: 'pending' })
    setShowForm(false)
    loadData()
  }

  async function handleStatusChange(jobId, newStatus) {
    const now = new Date().toISOString()
    
    const existing = await supabase
      .from('job_completions')
      .select('id')
      .eq('job_id', jobId)
      .single()
    
    if (existing.data) {
      await supabase
        .from('job_completions')
        .update({ 
          status: newStatus, 
          completed_at: newStatus === 'completed' ? now : null,
          updated_at: now 
        })
        .eq('job_id', jobId)
    } else {
      await supabase
        .from('job_completions')
        .insert([{
          job_id: jobId,
          status: newStatus,
          completed_at: newStatus === 'completed' ? now : null
        }])
    }
    
    loadData()
  }

  async function handlePhotoUpload(e, photoType, description) {
    const file = e.target.files[0]
    if (!file || !selectedJob) return
    
    try {
      const fileName = `${selectedJob.id}/${Date.now()}-${file.name}`
      
      const { error: uploadError } = await supabase.storage
        .from('worker-photos')
        .upload(fileName, file)
      
      if (uploadError) throw uploadError
      
      const { data: { publicUrl } } = supabase.storage
        .from('worker-photos')
        .getPublicUrl(fileName)
      
      await supabase.from('job_photos').insert([{
        job_id: selectedJob.id,
        photo_type: photoType,
        photo_url: publicUrl,
        description: description
      }])
      
      setShowPhotoModal(false)
      loadData()
    } catch (err) {
      alert('Error uploading photo: ' + err.message)
    }
  }

  const getStatusColor = (status) => {
    switch(status) {
      case 'completed': return 'badge-success'
      case 'in_progress': return 'badge-info'
      case 'pending': return 'badge-warning'
      case 'skipped': return 'badge-danger'
      case 'snag_reported': return 'badge-danger'
      default: return 'badge-info'
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="text-gray-500">Loading...</span></div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">Manage your cleaning jobs</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
          {showForm ? 'Cancel' : '+ Add Job'}
        </button>
      </div>

      {showForm && (
        <div className="card-static p-6 mb-6">
          <h3 className="font-medium mb-4">Add New Job</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Customer</label>
              <select
                value={newJob.customer_id}
                onChange={e => setNewJob({...newJob, customer_id: e.target.value})}
                className="input"
              >
                <option value="">Select customer</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Route</label>
              <select
                value={newJob.route_id}
                onChange={e => setNewJob({...newJob, route_id: e.target.value})}
                className="input"
              >
                <option value="">Select route</option>
                {routes.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={handleSave} className="btn btn-primary mt-4">
            Save Job
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="stat-card">
          <p className="stat-label">Total Jobs</p>
          <p className="stat-value" style={{color: '#3b82f6'}}>{jobs.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Completed</p>
          <p className="stat-value" style={{color: '#22c55e'}}>{jobs.filter(j => j.completion?.status === 'completed').length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Pending</p>
          <p className="stat-value" style={{color: '#f59e0b'}}>{jobs.filter(j => !j.completion?.status || j.completion.status === 'pending').length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Snags</p>
          <p className="stat-value" style={{color: '#ef4444'}}>{jobs.filter(j => j.completion?.status === 'snag_reported').length}</p>
        </div>
      </div>

      <div className="card-static overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Address</th>
              <th>Route</th>
              <th>Date</th>
              <th>Photos</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  No jobs yet. Add a job to get started.
                </td>
              </tr>
            ) : jobs.map(job => (
              <tr key={job.id}>
                <td className="font-medium">{job.customers?.name || 'Unknown'}</td>
                <td className="text-gray-600">{job.customers?.address_line_1}, {job.customers?.postcode}</td>
                <td>{job.routes?.name || 'Unassigned'}</td>
                <td>{job.routes?.scheduled_date || '-'}</td>
                <td>
                  {job.photos?.length > 0 && (
                    <div className="flex gap-1">
                      {job.photos.slice(0, 3).map((photo, i) => (
                        <a
                          key={i}
                          href={photo.photo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center text-xs"
                          title={photo.photo_type}
                        >
                          📷
                        </a>
                      ))}
                      {job.photos.length > 3 && (
                        <span className="text-xs text-gray-500">+{job.photos.length - 3}</span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`badge ${getStatusColor(job.completion?.status || 'pending')}`}>
                    {job.completion?.status || 'pending'}
                  </span>
                </td>
                <td>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setSelectedJob(job)
                        setShowPhotoModal(true)
                      }}
                      className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
                    >
                      📷 Photo
                    </button>
                    {job.completion?.status === 'completed' ? (
                      <button
                        onClick={() => handleStatusChange(job.id, 'pending')}
                        className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange(job.id, 'completed')}
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        ✓ Complete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showPhotoModal && selectedJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Add Photo to Job</h3>
            <p className="text-sm text-gray-600 mb-4">
              Customer: {selectedJob.customers?.name}<br/>
              Address: {selectedJob.customers?.address_line_1}
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Photo Type</label>
                <select id="photoType" className="input">
                  <option value="before">Before Cleaning</option>
                  <option value="after">After Cleaning</option>
                  <option value="damage">Report Damage</option>
                  <option value="snag">Report Snag</option>
                  <option value="completion">Proof of Completion</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  id="photoDesc"
                  className="input"
                  rows={3}
                  placeholder="Describe any issues..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Select Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const type = document.getElementById('photoType').value
                    const desc = document.getElementById('photoDesc').value
                    handlePhotoUpload(e, type, desc)
                  }}
                  className="input"
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowPhotoModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}