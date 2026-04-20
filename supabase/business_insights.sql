-- Business Insights tables

CREATE TABLE IF NOT EXISTS business_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN (
    'weekly_summary', 'monthly_review', 'quarterly_analysis',
    'anomaly_alert', 'milestone', 'trend_alert'
  )),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  headline TEXT NOT NULL,
  narrative TEXT,
  metrics JSONB,
  highlights JSONB DEFAULT '[]',
  concerns JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS report_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  sql_generated TEXT,
  result_summary TEXT,
  result_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_insights_user ON business_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_type ON business_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_insights_period ON business_insights(period_start DESC);
CREATE INDEX IF NOT EXISTS idx_queries_user ON report_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_queries_created ON report_queries(created_at DESC);

-- RLS
ALTER TABLE business_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insights" ON business_insights
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insights" ON business_insights
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own queries" ON report_queries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queries" ON report_queries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Helper: Get company name
CREATE OR REPLACE FUNCTION get_company_name(user_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN (SELECT company_name FROM company_settings WHERE profiles_id = user_uuid LIMIT 1);
END;
$$;