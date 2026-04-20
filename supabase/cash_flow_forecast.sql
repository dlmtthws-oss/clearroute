-- Cash Flow Forecasting tables

-- Forecasts table
CREATE TABLE IF NOT EXISTS cash_flow_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  forecast_data JSONB NOT NULL,
  assumptions JSONB,
  confidence_score NUMERIC(3,2) DEFAULT 0.50,
  ai_summary TEXT,
  ai_recommendations JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Actuals tracking table
CREATE TABLE IF NOT EXISTS cash_flow_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE UNIQUE NOT NULL,
  actual_revenue NUMERIC(10,2) DEFAULT 0,
  actual_expenses NUMERIC(10,2) DEFAULT 0,
  actual_net NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_forecasts_user ON cash_flow_forecasts(user_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_date ON cash_flow_forecasts(forecast_date DESC);
CREATE INDEX IF NOT EXISTS idx_actuals_user ON cash_flow_actuals(user_id);
CREATE INDEX IF NOT EXISTS idx_actuals_date ON cash_flow_actuals(date);

-- RLS
ALTER TABLE cash_flow_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_actuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own forecasts" ON cash_flow_forecasts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own forecasts" ON cash_flow_forecasts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own actuals" ON cash_flow_actuals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own actuals" ON cash_flow_actuals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Helper function: Get historical revenue by month
CREATE OR REPLACE FUNCTION get_monthly_revenue(months_back INTEGER DEFAULT 12)
RETURNS TABLE(month DATE, revenue NUMERIC, invoice_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('month', p.created_at)::DATE AS month,
    COALESCE(SUM(p.amount), 0) AS revenue,
    COUNT(DISTINCT p.invoice_id)::BIGINT AS invoice_count
  FROM payments p
  JOIN invoices i ON p.invoice_id = i.id
  WHERE p.created_at >= CURRENT_DATE - (months_back || ' months')::INTERVAL
    AND i.status = 'paid'
  GROUP BY DATE_TRUNC('month', p.created_at)
  ORDER BY month;
END;
$$;

-- Helper function: Get outstanding invoices with reliability weights
CREATE OR REPLACE FUNCTION get_outstanding_with_reliability()
RETURNS TABLE(invoice_id UUID, customer_name TEXT, amount NUMERIC, due_date DATE, reliability_weight NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH customer_stats AS (
    SELECT
      i.customer_id,
      AVG(CASE 
        WHEN p.created_at - i.due_date < 0 THEN 0
        WHEN p.created_at - i.due_date <= 5 THEN 0.9
        WHEN p.created_at - i.due_date <= 20 THEN 0.7
        ELSE 0.4
      END) AS avg_reliability
    FROM invoices i
    JOIN payments p ON p.invoice_id = i.id
    WHERE i.status = 'paid'
    GROUP BY i.customer_id
  )
  SELECT
    i.id,
    c.name,
    i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS amount,
    i.due_date,
    COALESCE(cs.avg_reliability, 0.7)
  FROM invoices i
  JOIN customers c ON i.customer_id = c.id
  LEFT JOIN customer_stats cs ON cs.customer_id = i.customer_id
  WHERE i.status IN ('sent', 'overdue')
    AND i.total > COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)
  ORDER BY amount DESC;
END;
$$;