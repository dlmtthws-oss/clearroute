-- Activity Log table
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_type TEXT CHECK (entity_type IN ('route', 'invoice', 'customer', 'payment', 'worker', 'none')),
  entity_id UUID,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "activity_read" ON activity_log FOR SELECT USING (true);
CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (true);

-- Index for performance
CREATE INDEX IF NOT EXISTS activity_created_idx ON activity_log(created_at DESC);

-- Function to log activity
CREATE OR REPLACE FUNCTION log_activity(
  p_event_type TEXT,
  p_description TEXT,
  p_entity_type TEXT DEFAULT 'none',
  p_entity_id UUID DEFAULT NULL,
  p_worker_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO activity_log (event_type, description, entity_type, entity_id, worker_id, metadata)
  VALUES (p_event_type, p_description, p_entity_type, p_entity_id, p_worker_id, p_metadata);
END;
$$ LANGUAGE plpgsql;