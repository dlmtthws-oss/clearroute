-- Smart Scheduling tables

CREATE TABLE IF NOT EXISTS scheduling_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN (
    'fill_gap', 'overdue_visit', 'rebalance_workload', 
    'new_customer_placement', 'recurring_optimization'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  suggested_route_id UUID REFERENCES routes(id),
  suggested_customer_ids UUID[],
  suggested_date DATE,
  suggested_worker_id UUID REFERENCES profiles(id),
  estimated_duration_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  accepted_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  dismissed_reason TEXT,
  ai_reasoning TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduling_user ON scheduling_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_status ON scheduling_suggestions(status, priority);
CREATE INDEX IF NOT EXISTS idx_scheduling_date ON scheduling_suggestions(suggested_date);
CREATE INDEX IF NOT EXISTS idx_scheduling_created ON scheduling_suggestions(created_at DESC);

-- RLS
ALTER TABLE scheduling_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own suggestions" ON scheduling_suggestions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own suggestions" ON scheduling_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own suggestions" ON scheduling_suggestions
  FOR UPDATE USING (auth.uid() = user_id);

-- Helper: Get customers not visited recently
CREATE OR REPLACE FUNCTION get_overdue_customers(days_threshold INTEGER DEFAULT 28)
RETURNS TABLE(customer_id UUID, customer_name TEXT, address TEXT, postcode TEXT, last_visit_date DATE, days_since_visit INTEGER, route_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS customer_id,
    c.name AS customer_name,
    c.address_line_1 AS address,
    c.postcode AS postcode,
    MAX(j.completed_at)::DATE AS last_visit_date,
    CURRENT_DATE - MAX(j.completed_at)::DATE AS days_since_visit,
    r.id AS route_id
  FROM customers c
  LEFT JOIN route_stops rs ON rs.customer_id = c.id
  LEFT JOIN routes r ON r.id = rs.route_id AND r.status = 'completed'
  LEFT JOIN jobs j ON j.route_stop_id = rs.id AND j.status = 'completed'
  WHERE c.profiles_id IS NOT NULL
    AND c.service_type != 'one_off'
  GROUP BY c.id, c.name, c.address_line_1, c.postcode, r.id
  HAVING CURRENT_DATE - MAX(j.completed_at)::DATE > days_threshold
  ORDER BY days_since_visit DESC;
END;
$$;

-- Helper: Get workers with upcoming workload
CREATE OR REPLACE FUNCTION get_worker_workload()
RETURNS TABLE(worker_id UUID, worker_name TEXT, jobs_scheduled INTEGER, routes_scheduled INTEGER, estimated_minutes INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS worker_id,
    p.name AS worker_name,
    COUNT(DISTINCT j.id)::INTEGER AS jobs_scheduled,
    COUNT(DISTINCT r.id)::INTEGER AS routes_scheduled,
    COALESCE(SUM(r.estimated_minutes), 0)::INTEGER AS estimated_minutes
  FROM profiles p
  LEFT JOIN routes r ON r.worker_id = p.id AND r.scheduled_date >= CURRENT_DATE AND r.scheduled_date < CURRENT_DATE + 14
  LEFT JOIN route_stops rs ON rs.route_id = r.id
  LEFT JOIN jobs j ON j.route_stop_id = rs.id
  WHERE p.role = 'worker'
    AND p.is_active = true
  GROUP BY p.id, p.name
  ORDER BY jobs_scheduled DESC;
END;
$$;

-- Helper: Get upcoming schedule gaps
CREATE OR REPLACE FUNCTION get_schedule_gaps()
RETURNS TABLE(gap_date DATE, worker_name TEXT, hours_available NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + 13, '1 day'::INTERVAL) AS day
  ),
  worker_days AS (
    SELECT d.day, p.id AS worker_id, p.name AS worker_name
    FROM date_range d
    CROSS JOIN profiles p
    WHERE p.role = 'worker' AND p.is_active = true
  ),
  route_hours AS (
    SELECT r.scheduled_date AS day, r.worker_id, SUM(r.estimated_minutes / 60.0) AS hours_scheduled
    FROM routes r
    WHERE r.scheduled_date >= CURRENT_DATE 
      AND r.scheduled_date < CURRENT_DATE + 14
      AND r.status != 'cancelled'
    GROUP BY r.scheduled_date, r.worker_id
  )
  SELECT 
    wd.day,
    wd.worker_name,
    GREATEST(0, 8 - COALESCE(rh.hours_scheduled, 0)) AS hours_available
  FROM worker_days wd
  LEFT JOIN route_hours rh ON rh.day = wd.day AND rh.worker_id = wd.worker_id
  WHERE GREATEST(0, COALESCE(rh.hours_scheduled, 0)) < 6
  ORDER BY wd.day, hours_available DESC;
END;
$$;