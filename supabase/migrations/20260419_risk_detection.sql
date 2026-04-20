-- ClearRoute Risk Detection System
-- Run this in the Supabase SQL Editor

-- ============================================================
-- Table: risk_events
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT,
  ai_assessment TEXT,
  affected_entity_type TEXT,
  affected_entity_id UUID,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ip_address TEXT,
  risk_score NUMERIC(3,2) DEFAULT 0.00,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_events_status ON risk_events(status);
CREATE INDEX idx_risk_events_severity ON risk_events(severity);
CREATE INDEX idx_risk_events_event_type ON risk_events(event_type);
CREATE INDEX idx_risk_events_user_id ON risk_events(user_id);
CREATE INDEX idx_risk_events_created_at ON risk_events(created_at DESC);
CREATE INDEX idx_risk_events_affected_entity ON risk_events(affected_entity_type, affected_entity_id);

-- ============================================================
-- Table: risk_thresholds
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_type TEXT NOT NULL UNIQUE,
  value NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default thresholds
INSERT INTO risk_thresholds (threshold_type, value, is_active) VALUES
  ('failed_login_attempts_threshold', 5, true),
  ('unusual_hour_start', 6, true),
  ('unusual_hour_end', 22, true),
  ('bulk_delete_customers_threshold', 5, true),
  ('bulk_delete_invoices_threshold', 10, true),
  ('duplicate_payment_multiplier', 2, true),
  ('suspicious_amount_threshold', 500, true),
  ('mandate_cancellations_per_day', 3, true),
  ('portal_token_regeneration_limit', 3, true),
  ('token_regeneration_window_days', 30, true)
ON CONFLICT (threshold_type) DO NOTHING;

-- ============================================================
-- Table: login_attempts (for tracking login patterns)
-- ============================================================
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  country TEXT,
  city TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_user_id ON login_attempts(user_id);
CREATE INDEX idx_login_attempts_created_at ON login_attempts(created_at DESC);
CREATE INDEX idx_login_attempts_user_created ON login_attempts(user_id, created_at DESC);

-- ============================================================
-- Table: user_sessions (for tracking devices)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  country TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_trusted BOOLEAN DEFAULT false
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);

-- ============================================================
-- View: open_risk_events_summary
-- ============================================================
CREATE OR REPLACE VIEW open_risk_events_summary AS
SELECT 
  event_type,
  severity,
  COUNT(*) as event_count,
  MAX(created_at) as latest_event
FROM risk_events
WHERE status IN ('open', 'investigating')
GROUP BY event_type, severity;

-- ============================================================
-- View: risk_statistics
-- ============================================================
CREATE OR REPLACE VIEW risk_statistics AS
SELECT 
  DATE_TRUNC('day', created_at) as date,
  severity,
  COUNT(*) as count
FROM risk_events
GROUP BY DATE_TRUNC('day', created_at), severity;

-- ============================================================
-- Function: resolve_risk_event
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_risk_event(
  p_event_id UUID,
  p_resolved_by UUID,
  p_status TEXT,
  p_resolution_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE risk_events
  SET status = p_status,
      resolved_by = p_resolved_by,
      resolved_at = NOW(),
      resolution_note = p_resolution_note
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- pg_cron schedule for weekly security report
-- ============================================================
-- Note: Enable pg_cron extension first if not enabled:
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule: Fridays at 16:00 UTC
-- SELECT cron.schedule(
--   'weekly-security-report',
--   '0 16 * * 5',
--   $$SELECT net.http_request(
--     method=>'POST',
--     url=>'https://project-ref.supabase.co/functions/v1/generate-weekly-security-report',
--     headers=>'{"Content-Type":"application/json","Authorization":"Bearer "'||current_setting('app.settings.service_role_key', true)
--   )$$
-- );