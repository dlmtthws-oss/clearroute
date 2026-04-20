-- Route Sessions table
CREATE TABLE IF NOT EXISTS route_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  total_estimated_minutes INTEGER,
  total_actual_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Executions table
CREATE TABLE IF NOT EXISTS job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_session_id UUID REFERENCES route_sessions(id) ON DELETE CASCADE,
  route_stop_id UUID REFERENCES route_stops(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'travelling', 'on_site', 'completed', 'skipped')),
  arrived_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  estimated_minutes INTEGER,
  actual_minutes INTEGER,
  notes TEXT,
  skipped_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add estimated_duration to route_stops if not exists
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS estimated_duration INTEGER DEFAULT 30;

-- Enable RLS
ALTER TABLE route_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_executions ENABLE ROW LEVEL SECURITY;

-- Policies for route_sessions
CREATE POLICY "sessions_read" ON route_sessions FOR SELECT USING (true);
CREATE POLICY "sessions_insert" ON route_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "sessions_update" ON route_sessions FOR UPDATE USING (true);
CREATE POLICY "sessions_delete" ON route_sessions FOR DELETE USING (true);

-- Policies for job_executions
CREATE POLICY "executions_read" ON job_executions FOR SELECT USING (true);
CREATE POLICY "executions_insert" ON job_executions FOR INSERT WITH CHECK (true);
CREATE POLICY "executions_update" ON job_executions FOR UPDATE USING (true);
CREATE POLICY "executions_delete" ON job_executions FOR DELETE USING (true);

-- Function to calculate actual minutes between timestamps
CREATE OR REPLACE FUNCTION calculate_minutes(start_ts TIMESTAMP WITH TIME ZONE, end_ts TIMESTAMP WITH TIME ZONE)
RETURNS INTEGER AS $$
BEGIN
  IF start_ts IS NULL OR end_ts IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN EXTRACT(EPOCH FROM (end_ts - start_ts)) / 60;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Index for performance
CREATE INDEX IF NOT EXISTS route_sessions_date_idx ON route_sessions(date);
CREATE INDEX IF NOT EXISTS route_sessions_worker_idx ON route_sessions(worker_id);
CREATE INDEX IF NOT EXISTS job_executions_session_idx ON job_executions(route_session_id);