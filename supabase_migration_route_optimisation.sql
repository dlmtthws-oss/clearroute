-- Route Optimisation AI Features Migration
-- Creates tables for AI-powered route optimisation learning from historical performance

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: route_optimisation_runs
-- Stores AI optimisation suggestions and their outcomes
CREATE TABLE IF NOT EXISTS route_optimisation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  optimisation_type TEXT NOT NULL CHECK (optimisation_type IN ('geographic', 'ai_enhanced', 'predictive')),
  original_stop_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_stop_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  original_estimated_minutes INTEGER,
  suggested_estimated_minutes INTEGER,
  improvement_minutes INTEGER,
  improvement_percent NUMERIC(5,2),
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  factors_used JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_explanation TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  accepted_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: stop_performance_history
-- Stores historical performance data per stop for AI learning
CREATE TABLE IF NOT EXISTS stop_performance_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  avg_actual_minutes NUMERIC(5,2) NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 1 CHECK (sample_count >= 1),
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(customer_id, day_of_week, month, hour_of_day)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_route_optimisation_runs_route_id ON route_optimisation_runs(route_id);
CREATE INDEX IF NOT EXISTS idx_route_optimisation_runs_status ON route_optimisation_runs(status);
CREATE INDEX IF NOT EXISTS idx_route_optimisation_runs_created_at ON route_optimisation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stop_performance_history_customer_id ON stop_performance_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_stop_performance_history_lookup ON stop_performance_history(customer_id, day_of_week, month, hour_of_day);

-- Function: update_stop_performance
-- Updates or inserts stop performance history from job completions
CREATE OR REPLACE FUNCTION update_stop_performance(
  p_customer_id UUID,
  p_day_of_week INTEGER,
  p_month INTEGER,
  p_hour_of_day INTEGER,
  p_actual_minutes NUMERIC(5,2)
) RETURNS void AS $$
BEGIN
  INSERT INTO stop_performance_history (customer_id, day_of_week, month, hour_of_day, avg_actual_minutes, sample_count)
  VALUES (p_customer_id, p_day_of_week, p_month, p_hour_of_day, p_actual_minutes, 1)
  ON CONFLICT (customer_id, day_of_week, month, hour_of_day)
  DO UPDATE SET
    avg_actual_minutes = (
      (stop_performance_history.avg_actual_minutes * stop_performance_history.sample_count + p_actual_minutes) /
      (stop_performance_history.sample_count + 1)
    ),
    sample_count = stop_performance_history.sample_count + 1,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: get_stop_performance
-- Retrieves performance data for a stop at a specific time
CREATE OR REPLACE FUNCTION get_stop_performance(
  p_customer_id UUID,
  p_day_of_week INTEGER,
  p_month INTEGER,
  p_hour_of_day INTEGER
) RETURNS TABLE(avg_actual_minutes NUMERIC(5,2), sample_count INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT sph.avg_actual_minutes, sph.sample_count
  FROM stop_performance_history sph
  WHERE sph.customer_id = p_customer_id
    AND sph.day_of_week = p_day_of_week
    AND sph.month = p_month
    AND sph.hour_of_day = p_hour_of_day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: accept_route_optimisation
-- Accepts an optimisation suggestion and updates the route
CREATE OR REPLACE FUNCTION accept_route_optimisation(p_run_id UUID)
RETURNS void AS $$
DECLARE
  v_route_id UUID;
  v_suggested_order JSONB;
BEGIN
  SELECT ror.route_id, ror.suggested_stop_order INTO v_route_id, v_suggested_order
  FROM route_optimisation_runs ror
  WHERE ror.id = p_run_id;

  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'Optimisation run not found';
  END IF;

  UPDATE routes
  SET stops = v_suggested_order, updated_at = NOW()
  WHERE id = v_route_id;

  UPDATE route_optimisation_runs
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: reject_route_optimisation
-- Rejects an optimisation suggestion
CREATE OR REPLACE FUNCTION reject_route_optimisation(p_run_id UUID, p_reason TEXT)
RETURNS void AS $$
BEGIN
  UPDATE route_optimisation_runs
  SET status = 'rejected', rejected_at = NOW(), rejection_reason = p_reason
  WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View: route_optimisation_summary
-- Provides a summary view of all optimisation runs
CREATE OR REPLACE VIEW route_optimisation_summary AS
SELECT
  ror.id,
  ror.route_id,
  r.name AS route_name,
  ror.optimisation_type,
  ror.status,
  ror.original_estimated_minutes,
  ror.suggested_estimated_minutes,
  ror.improvement_minutes,
  ror.improvement_percent,
  ror.confidence_score,
  ror.created_at,
  ror.accepted_at,
  ror.rejected_at
FROM route_optimisation_runs ror
LEFT JOIN routes r ON r.id = ror.route_id;

-- View: stop_performance_summary
-- Shows performance stats per customer/stop
CREATE OR REPLACE VIEW stop_performance_summary AS
SELECT
  customer_id,
  COUNT(*) as time_slots_tracked,
  SUM(sample_count) as total_samples,
  AVG(avg_actual_minutes) as overall_avg_minutes,
  MIN(avg_actual_minutes) as min_avg_minutes,
  MAX(avg_actual_minutes) as max_avg_minutes
FROM stop_performance_history
GROUP BY customer_id;

-- Row Level Security (RLS) - Let anon read, service role write
ALTER TABLE route_optimisation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_performance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read route_optimisation_runs" ON route_optimisation_runs
  FOR SELECT USING (true);
CREATE POLICY "Allow service role all route_optimisation_runs" ON route_optimisation_runs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read stop_performance_history" ON stop_performance_history
  FOR SELECT USING (true);
CREATE POLICY "Allow service role all stop_performance_history" ON stop_performance_history
  FOR ALL USING (true) WITH CHECK (true);