-- Workers table
CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT DEFAULT 'worker' CHECK (role IN ('worker', 'supervisor', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job photos table for snags and damage proof
CREATE TABLE IF NOT EXISTS job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES route_stops(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('before', 'after', 'snag', 'damage', 'completion')),
  photo_url TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job completions table
CREATE TABLE IF NOT EXISTS job_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES route_stops(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'snag_reported')),
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_completions ENABLE ROW LEVEL SECURITY;

-- Workers policy (users can read workers)
CREATE POLICY "workers_read" ON workers FOR SELECT USING (true);

-- Workers policy (service role can all)
CREATE POLICY "workers_service_all" ON workers FOR ALL USING (true) WITH CHECK (true);

-- Job photos policies
CREATE POLICY "job_photos_read" ON job_photos FOR SELECT USING (true);
CREATE POLICY "job_photos_service_all" ON job_photos FOR ALL USING (true) WITH CHECK (true);

-- Job completions policies
CREATE POLICY "job_completions_read" ON job_completions FOR SELECT USING (true);
CREATE POLICY "job_completions_service_all" ON job_completions FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for worker photos
INSERT INTO storage.buckets (id, name, public) VALUES ('worker-photos', 'worker-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "worker_photos_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'worker-photos');
CREATE POLICY "worker_photos_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'worker-photos');