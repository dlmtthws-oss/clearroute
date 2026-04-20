import { supabase } from './supabase'

export async function seedDemoData() {
  // Check if workers already exist
  const { data: existingWorkers } = await supabase.from('workers').select('id')
  
  if (existingWorkers?.length > 0) {
    console.log('Demo workers already exist')
    return
  }

  // Add demo workers
  const workers = [
    { name: 'John Smith', email: 'john@clearroute.co.uk', phone: '07123456789', role: 'worker', is_active: true },
    { name: 'Sarah Jones', email: 'sarah@clearroute.co.uk', phone: '07123456788', role: 'worker', is_active: true },
    { name: 'Mike Wilson', email: 'mike@clearroute.co.uk', phone: '07123456787', role: 'supervisor', is_active: true },
  ]

  const { error } = await supabase.from('workers').insert(workers)
  
  if (error) {
    console.error('Error seeding workers:', error)
  } else {
    console.log('Demo workers added successfully')
  }
}
