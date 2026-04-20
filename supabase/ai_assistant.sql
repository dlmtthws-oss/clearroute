-- AI Assistant tables for ClearRoute Copilot

-- Conversations table
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_results JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Query log for analytics
CREATE TABLE IF NOT EXISTS ai_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  response_summary TEXT,
  data_accessed TEXT[],
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created ON ai_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_query_log_user ON ai_query_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_log_created ON ai_query_log(created_at);

-- RLS
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations" ON ai_conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations" ON ai_conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations" ON ai_conversations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own messages" ON ai_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM ai_conversations WHERE id = ai_messages.conversation_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can insert own messages" ON ai_messages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM ai_conversations WHERE id = ai_messages.conversation_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can view own query logs" ON ai_query_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "User can insert query logs" ON ai_query_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- System function for queries (runs with SECURITY DEFINER)
CREATE OR REPLACE FUNCTION get_revenue_summary(period TEXT, year_num INTEGER, month_num INTEGER)
RETURNS TABLE(total_revenue NUMERIC, invoice_count BIGINT, avg_invoice_value NUMERIC, previous_period_revenue NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH period_range AS (
    SELECT
      CASE
        WHEN period = 'today' THEN CURRENT_DATE
        WHEN period = 'week' THEN CURRENT_DATE - INTERVAL '7 days'
        WHEN period = 'month' THEN DATE_TRUNC('month', CURRENT_DATE)::DATE
        WHEN period = 'quarter' THEN DATE_TRUNC('quarter', CURRENT_DATE)::DATE
        WHEN period = 'year' THEN DATE_TRUNC('year', CURRENT_DATE)::DATE
        ELSE CURRENT_DATE - INTERVAL '30 days'
      END AS start_date
  ),
  current AS (
    SELECT
      COALESCE(SUM(p.amount), 0) AS total,
      COUNT(DISTINCT p.invoice_id) AS count,
      AVG(p.amount) AS avg
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= (SELECT start_date FROM period_range)
      AND i.status = 'paid'
  ),
  previous AS (
    SELECT COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= (SELECT start_date - INTERVAL '1 month' FROM period_range)
      AND p.created_at < (SELECT start_date FROM period_range)
      AND i.status = 'paid'
  )
  SELECT current.total, current.count::BIGINT, COALESCE(current.avg, 0), previous.total
  FROM current, previous;
END;
$$;

CREATE OR REPLACE FUNCTION get_outstanding_invoices(limit_num INTEGER DEFAULT 10, min_days INTEGER DEFAULT 0)
RETURNS TABLE(customer_name TEXT, amount NUMERIC, days_overdue INTEGER, invoice_number TEXT, due_date DATE)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.name,
    i.total - COALESCE(
      (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id),
      0
    ) AS amount,
    GREATEST(0, CURRENT_DATE - i.due_date) AS days_overdue,
    i.invoice_number,
    i.due_date
  FROM invoices i
  JOIN customers c ON i.customer_id = c.id
  WHERE i.status IN ('sent', 'overdue')
    AND (CURRENT_DATE - i.due_date) >= min_days
  ORDER BY amount DESC
  LIMIT limit_num;
END;
$$;

CREATE OR REPLACE FUNCTION get_customer_summary(customer_name TEXT, limit_num INTEGER DEFAULT 20, sort_by TEXT DEFAULT 'revenue')
RETURNS TABLE(customer_name TEXT, total_invoiced NUMERIC, total_paid NUMERIC, outstanding_balance NUMERIC, last_invoice_date DATE, invoice_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.name,
    COALESCE(SUM(i.total), 0) AS total_invoiced,
    COALESCE(
      (SELECT SUM(p.amount) FROM payments p JOIN invoices inv ON p.invoice_id = inv.id WHERE inv.customer_id = c.id AND inv.status = 'paid'),
      0
    ) AS total_paid,
    COALESCE(SUM(i.total), 0) - COALESCE(
      (SELECT SUM(p.amount) FROM payments p JOIN invoices inv ON p.invoice_id = inv.id WHERE inv.customer_id = c.id),
      0
    ) AS outstanding_balance,
    MAX(i.issue_date) AS last_invoice_date,
    COUNT(i.id)::BIGINT AS invoice_count
  FROM customers c
  LEFT JOIN invoices i ON i.customer_id = c.id
  WHERE ($1 IS NULL OR c.name ILIKE '%' || $1 || '%')
  GROUP BY c.id, c.name
  ORDER BY
    CASE WHEN sort_by = 'revenue' THEN SUM(i.total)
         WHEN sort_by = 'outstanding' THEN SUM(i.total) - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices inv ON p.invoice_id = inv.id WHERE inv.customer_id = c.id), 0)
         ELSE MAX(i.issue_date)
    END DESC
  LIMIT limit_num;
END;
$$;

CREATE OR REPLACE FUNCTION get_expense_summary(period TEXT, category TEXT)
RETURNS TABLE(total_amount NUMERIC, vat_reclaimable NUMERIC, category_totals JSONB)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(e.amount), 0),
    COALESCE(SUM(CASE WHEN e.vat_reclaimable THEN e.vat_amount ELSE 0 END), 0),
    jsonb_object_agg(
      COALESCE(e.category, 'other'),
      COALESCE(SUM(e.amount), 0)
    ) FILTER (WHERE e.category IS NOT NULL)
  FROM expenses e
  WHERE ($1 IS NULL OR e.expense_date >= CASE
    WHEN $1 = 'month' THEN DATE_TRUNC('month', CURRENT_DATE)
    WHEN $1 = 'quarter' THEN DATE_TRUNC('quarter', CURRENT_DATE)
    WHEN $1 = 'year' THEN DATE_TRUNC('year', CURRENT_DATE)
    ELSE CURRENT_DATE - INTERVAL '30 days'
  END)
    AND ($2 IS NULL OR e.category = $2);
END;
$$;

CREATE OR REPLACE FUNCTION get_worker_performance(worker_name TEXT, period TEXT)
RETURNS TABLE(worker_name TEXT, routes_completed BIGINT, jobs_completed BIGINT, avg_variance_minutes NUMERIC, completion_rate NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.name,
    COUNT(DISTINCT r.id)::BIGINT AS routes_completed,
    COUNT(j.id)::BIGINT AS jobs_completed,
    AVG(r.actual_minutes - r.estimated_minutes) AS avg_variance,
    CASE WHEN COUNT(r.id) > 0 THEN COUNT(*)::NUMERIC / COUNT(r.id) * 100 ELSE 0 END
  FROM profiles p
  JOIN routes r ON r.worker_id = p.id
  LEFT JOIN jobs j ON j.route_id = r.id AND j.status = 'completed'
  WHERE r.status = 'completed'
    AND ($1 IS NULL OR p.name ILIKE '%' || $1 || '%')
    AND ($2 IS NULL OR r.scheduled_date >= CASE
      WHEN $2 = 'week' THEN CURRENT_DATE - INTERVAL '7 days'
      WHEN $2 = 'month' THEN DATE_TRUNC('month', CURRENT_DATE)
      WHEN $2 = 'quarter' THEN DATE_TRUNC('quarter', CURRENT_DATE)
      ELSE CURRENT_DATE - INTERVAL '30 days'
    END)
  GROUP BY p.id, p.name
  ORDER BY routes_completed DESC;
END;
$$;