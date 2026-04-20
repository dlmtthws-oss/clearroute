-- Customer Churn Prediction tables

CREATE TABLE IF NOT EXISTS customer_churn_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  churn_score NUMERIC(3,2) NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_factors JSONB DEFAULT '[]',
  ai_analysis TEXT,
  suggested_actions JSONB DEFAULT '[]',
  score_date DATE NOT NULL,
  previous_score NUMERIC(3,2),
  score_change NUMERIC(3,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  churn_score_id UUID REFERENCES customer_churn_scores(id),
  intervention_type TEXT NOT NULL CHECK (intervention_type IN ('email_sent', 'call_logged', 'discount_offered', 'visit_scheduled', 'note_added')),
  notes TEXT,
  outcome TEXT DEFAULT 'ongoing' CHECK (outcome IN ('resolved', 'ongoing', 'churned', 'no_action')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_churn_customer ON customer_churn_scores(customer_id);
CREATE INDEX IF NOT EXISTS idx_churn_score_date ON customer_churn_scores(score_date DESC);
CREATE INDEX IF NOT EXISTS idx_churn_risk_level ON customer_churn_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_interventions_customer ON customer_interventions(customer_id);
CREATE INDEX IF NOT EXISTS idx_interventions_created ON customer_interventions(created_at DESC);

-- RLS
ALTER TABLE customer_churn_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own churn scores" ON customer_churn_scores
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own churn scores" ON customer_churn_scores
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own churn scores" ON customer_churn_scores
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own interventions" ON customer_interventions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_interventions.customer_id AND c.profiles_id = auth.uid())
  );

CREATE POLICY "Users can insert own interventions" ON customer_interventions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_interventions.customer_id AND c.profiles_id = auth.uid())
  );

-- Helper: Get customer risk signals
CREATE OR REPLACE FUNCTION get_customer_risk_signals(cust_id UUID)
RETURNS TABLE(
  customer_name TEXT,
  days_since_last_visit INTEGER,
  payment_delay_trend NUMERIC,
  missed_payments INTEGER,
  outstanding_balance NUMERIC,
  total_invoiced NUMERIC,
  spend_trend NUMERIC,
  visit_frequency_current INTEGER,
  visit_frequency_previous INTEGER,
  skipped_jobs_ratio NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH customer_last_visit AS (
    SELECT MAX(j.completed_at)::DATE AS last_visit
    FROM jobs j
    JOIN route_stops rs ON j.route_stop_id = rs.id
    WHERE rs.customer_id = cust_id AND j.status = 'completed'
  ),
  customer_payments AS (
    SELECT 
      AVG(LEAST(0, p.created_at - i.due_date)) AS avg_delay_current,
      COUNT(*) FILTER (WHERE p.created_at >= CURRENT_DATE - 180) AS payment_count
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    WHERE i.customer_id = cust_id
  ),
  customer_finance AS (
    SELECT
      COALESCE((SELECT SUM(total) FROM invoices WHERE customer_id = cust_id AND status IN ('sent', 'overdue', 'paid')), 0) AS total_invoiced,
      COALESCE((SELECT SUM(amount) FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.customer_id = cust_id AND i.status = 'paid' AND p.created_at >= CURRENT_DATE - 180), 0) AS spend_current,
      COALESCE((SELECT SUM(amount) FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.customer_id = cust_id AND i.status = 'paid' AND p.created_at >= CURRENT_DATE - 365 AND p.created_at < CURRENT_DATE - 180), 0) AS spend_previous
    FROM customers WHERE id = cust_id
  ),
  visit_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE j.completed_at >= CURRENT_DATE - 60) AS current_period,
      COUNT(*) FILTER (WHERE j.completed_at >= CURRENT_DATE - 425 AND j.completed_at < CURRENT_DATE - 365) AS previous_period
    FROM jobs j
    JOIN route_stops rs ON j.route_stop_id = rs.id
    WHERE rs.customer_id = cust_id AND j.status = 'completed'
  )
  SELECT
    c.name,
    COALESCE(CURRENT_DATE - (SELECT last_visit FROM customer_last_visit), 999) AS days_since_last_visit,
    0 AS payment_delay_trend,
    0 AS missed_payments,
    COALESCE((SELECT SUM(total) FROM invoices WHERE customer_id = cust_id AND status IN ('sent', 'overdue')), 0) AS outstanding_balance,
    cf.total_invoiced,
    CASE WHEN cf.spend_previous > 0 THEN (cf.spend_current - cf.spend_previous) / cf.spend_previous ELSE 0 END AS spend_trend,
    vc.current_period,
    vc.previous_period,
    0 AS skipped_jobs_ratio
  FROM customers c, customer_finance cf, visit_counts vc
  WHERE c.id = cust_id;
END;
$$;

-- Helper: Get all at-risk customers
CREATE OR REPLACE FUNCTION get_at_risk_customers()
RETURNS TABLE(customer_id UUID, customer_name TEXT, risk_level TEXT, churn_score NUMERIC, risk_factors JSONB, days_since_visit INTEGER, outstanding_balance NUMERIC, ai_analysis TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ccs.customer_id,
    c.name,
    ccs.risk_level,
    ccs.churn_score,
    ccs.risk_factors,
    COALESCE(CURRENT_DATE - (SELECT MAX(j.completed_at)::DATE FROM jobs j JOIN route_stops rs ON j.route_stop_id = rs.id WHERE rs.customer_id = c.id AND j.status = 'completed'), 999) AS days_since_visit,
    COALESCE((SELECT SUM(total) FROM invoices WHERE customer_id = c.id AND status IN ('sent', 'overdue')), 0) AS outstanding_balance,
    ccs.ai_analysis
  FROM customer_churn_scores ccs
  JOIN customers c ON c.id = ccs.customer_id
  WHERE ccs.score_date = CURRENT_DATE
    AND ccs.risk_level IN ('high', 'critical', 'medium')
  ORDER BY ccs.churn_score DESC;
END;
$$;