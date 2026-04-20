-- Expense AI Categorisation tables

CREATE TABLE IF NOT EXISTS expense_categorisation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('supplier', 'description')),
  suggested_category TEXT NOT NULL,
  suggested_vat_reclaimable BOOLEAN DEFAULT true,
  confidence NUMERIC(3,2) DEFAULT 0.50,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_by TEXT DEFAULT 'ai' CHECK (created_by IN ('ai', 'user')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_categorisation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  suggested_category TEXT,
  suggested_vat_reclaimable BOOLEAN,
  accepted BOOLEAN DEFAULT false,
  actual_category TEXT,
  actual_vat_reclaimable BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rules_user ON expense_categorisation_rules(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rules_pattern ON expense_categorisation_rules(pattern_type, pattern);
CREATE INDEX IF NOT EXISTS idx_rules_confidence ON expense_categorisation_rules(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_expense ON expense_categorisation_feedback(expense_id);

-- RLS
ALTER TABLE expense_categorisation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categorisation_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rules" ON expense_categorisation_rules
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rules" ON expense_categorisation_rules
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rules" ON expense_categorisation_rules
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own feedback" ON expense_categorisation_feedback
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feedback" ON expense_categorisation_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Helper: Get historical category for supplier
CREATE OR REPLACE FUNCTION get_historical_category(supplier_name TEXT, user_id UUID)
RETURNS TABLE(category TEXT, count BIGINT, pct NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT e.category, COUNT(*)::BIGINT, 
    COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER() * 100, 0
  FROM expenses e
  WHERE e.profiles_id = user_id
    AND LOWER(e.supplier) = LOWER(supplier_name)
    AND e.category IS NOT NULL
  GROUP BY e.category
  ORDER BY COUNT(*) DESC
  LIMIT 1;
END;
$$;

-- Helper: Get historical patterns from descriptions
CREATE OR REPLACE FUNCTION get_description_pattern_category(desc_pattern TEXT, user_id UUID)
RETURNS TABLE(category TEXT, confidence NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.category,
    COUNT(*)::NUMERIC / 10 AS confidence
  FROM expenses e
  WHERE e.profiles_id = user_id
    AND e.category IS NOT NULL
    AND LOWER(e.description) LIKE '%' || LOWER(desc_pattern) || '%'
  GROUP BY e.category
  ORDER BY COUNT(*) DESC
  LIMIT 1;
END;
$$;