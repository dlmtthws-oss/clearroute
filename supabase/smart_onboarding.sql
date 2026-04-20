-- Smart Onboarding Assistant tables

CREATE TABLE IF NOT EXISTS onboarding_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN (
    'pricing_suggestion', 'route_recommendation', 'setup_tip',
    'market_comparison', 'efficiency_suggestion', 'quick_win'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  action_label TEXT,
  action_url TEXT,
  priority INTEGER DEFAULT 5,
  is_dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS setup_score (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  company_details_complete BOOLEAN DEFAULT false,
  logo_uploaded BOOLEAN DEFAULT false,
  first_customer_added BOOLEAN DEFAULT false,
  first_route_created BOOLEAN DEFAULT false,
  gocardless_connected BOOLEAN DEFAULT false,
  first_invoice_sent BOOLEAN DEFAULT false,
  recurring_invoice_set_up BOOLEAN DEFAULT false,
  team_member_added BOOLEAN DEFAULT false,
  first_payment_collected BOOLEAN DEFAULT false,
  score INTEGER DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_insights_user ON onboarding_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_insights_type ON onboarding_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_onboarding_insights_priority ON onboarding_insights(priority);

ALTER TABLE onboarding_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE setup_score ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own onboarding insights" ON onboarding_insights
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding insights" ON onboarding_insights
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding insights" ON onboarding_insights
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own setup score" ON setup_score
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own setup score" ON setup_score
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own setup score" ON setup_score
  FOR UPDATE USING (auth.uid() = user_id);

-- UK pricing reference data as a function
CREATE OR REPLACE FUNCTION get_regional_pricing(postcode_prefix TEXT)
RETURNS TABLE(residential_min NUMERIC, residential_max NUMERIC, commercial_min NUMERIC, commercial_max NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH regions AS (
    SELECT 'London,S,E,SW,SE,W,NW,NE,WC,EC' AS prefixes, 15.00 AS r_min, 25.00 AS r_max, 35.00 AS c_min, 80.00 AS c_max
    UNION ALL SELECT 'RG,GU,SL,HP', 12.00, 18.00, 25.00, 60.00
    UNION ALL SELECT 'M,SK,OL,BL', 8.00, 12.00, 18.00, 40.00
    UNION ALL SELECT 'NE,DH,SR', 7.00, 11.00, 16.00, 38.00
    UNION ALL SELECT 'CF,SA,NP', 7.00, 11.00, 15.00, 35.00
  )
  SELECT r_min, r_max, c_min, c_max
  FROM regions
  WHERE prefixes LIKE postcode_prefix || '%'
  LIMIT 1;
END;
$$;