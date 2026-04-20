import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function WorkerDashboard({ worker, onLogout }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [photoType, setPhotoType] = useState('before')
  const [photoDescription, setPhotoDescription] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (worker?.id) {
      loadJobs()
    }
  }, [worker?.id])

  async function loadJobs() {
    setLoading(true)
    
    const { data: routeStops } = await supabase
      .from('route_stops')
      .select('*, routes(name, scheduled_date), customers(name, address_line_1, postcode, phone)')
      .order(' routes(scheduled_date)', { ascending: true })
    
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
    setLoading(false)
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
          worker_id: worker.id,
          status: newStatus,
          completed_at: newStatus === 'completed' ? now : null
        }])
    }
    
    loadJobs()
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0]
    if (!file || !selectedJob) return
    
    setUploading(true)
    try {
      const fileName = `${selectedJob.id}/${Date.now()}-${file.name}`
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('worker-photos')
        .upload(fileName, file)
      
      if (uploadError) throw uploadError
      
      const { data: { publicUrl } } = supabase.storage
        .from('worker-photos')
        .getPublicUrl(fileName)
      
      await supabase.from('job_photos').insert([{
        job_id: selectedJob.id,
        worker_id: worker.id,
        photo_type: photoType,
        photo_url: publicUrl,
        description: photoDescription
      }])
      
      setShowPhotoModal(false)
      setPhotoDescription('')
      loadJobs()
    } catch (err) {
      alert('Error uploading photo: ' + err.message)
    }
    setUploading(false)
  }

  const pendingJobs = jobs.filter(j => !j.completion?.status || j.completion.status === 'pending')
  const completedJobs = jobs.filter(j => j.completion?.status === 'completed')
  const snagJobs = jobs.filter(j => j.completion?.status === 'snag_reported')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Jobs</h1>
          <p className="text-gray-600">Welcome, {worker?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{worker?.name}</span>
          <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-800">Worker</span>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Pending Jobs</p>
          <p className="text-3xl font-bold text-orange-600">{pendingJobs.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Completed Today</p>
          <p className="text-3xl font-bold text-green-600">{completedJobs.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Snags Reported</p>
          <p className="text-3xl font-bold text-red-600">{snagJobs.length}</p>
        </div>
      </div>

      {/* Job List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Today's Jobs</h2>
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No jobs assigned yet.</div>
        ) : (
          <div className="divide-y">
            {jobs.map(job => (
              <div key={job.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{job.customers?.name}</h3>
                      {job.completion?.status === 'completed' && (
                        <span className="badge badge-success">Completed</span>
                      )}
                      {job.completion?.status === 'snag_reported' && (
                        <span className="badge badge-danger">Snag</span>
                      )}
                      {job.completion?.status === 'in_progress' && (
                        <span className="badge badge-info">In Progress</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {job.customers?.address_line_1}, {job.customers?.postcode}
                    </p>
                    <p className="text-sm text-gray-500">
                      Route: {job.routes?.name} • {job.routes?.scheduled_date}
                    </p>
                    
                    {/* Photos */}
                    {job.photos?.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {job.photos.map((photo, i) => (
                          <a 
                            key={i}
                            href={photo.photo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                          >
                            {photo.photo_type}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedJob(job)
                        setPhotoType('damage')
                        setShowPhotoModal(true)
                      }}
                      className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Report Damage
                    </button>
                    <button
                      onClick={() => {
                        setSelectedJob(job)
                        setPhotoType('before')
                        setShowPhotoModal(true)
                      }}
                      className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    >
                      Add Photo
                    </button>
                    {job.completion?.status === 'completed' ? (
                      <button
                        onClick={() => handleStatusChange(job.id, 'pending')}
                        className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange(job.id, 'completed')}
                        className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Complete Job
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Photo Upload Modal */}
      {showPhotoModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              Add {photoType === 'damage' ? 'Damage Photo' : photoType === 'before' ? 'Before Photo' : 'After Photo'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Photo Type</label>
                <select
                  value={photoType}
                  onChange={e => setPhotoType(e.target.value)}
                  className="input"
                >
                  <option value="before">Before Cleaning</option>
                  <option value="after">After Cleaning</option>
                  <option value="damage">Report Damage</option>
                  <option value="snag">Report Snag</option>
                  <option value="completion">Proof of Completion</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Description (optional)</label>
                <textarea
                  value={photoDescription}
                  onChange={e => setPhotoDescription(e.target.value)}
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
                  onChange={handlePhotoUpload}
                  className="input file-input"
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