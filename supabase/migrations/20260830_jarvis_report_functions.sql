-- Jarvis report functions
--
-- These SECURITY DEFINER functions back the ai-assistant edge function's data
-- tools (get_revenue_summary / get_outstanding_invoices / get_customer_summary
-- / get_expense_summary). They were originally drafted in supabase/ai_assistant.sql
-- but never successfully applied to the ClearRoute database because of two
-- latent errors, both fixed here:
--   1. get_customer_summary declared an input parameter `customer_name` that
--      collided with an identically named RETURNS TABLE column (Postgres 42P13).
--      The output column is renamed to `name`; the input parameter keeps its
--      name so the edge function's `rpc('get_customer_summary', { customer_name })`
--      named argument still binds. The body references the input positionally
--      ($1), so it is unaffected.
--   2. The ORDER BY CASE mixed numeric branches (revenue / outstanding) with a
--      date branch (last invoice), which Postgres rejects at run time
--      (42804: CASE types date and numeric cannot be matched). The date branch
--      now casts to epoch seconds so every branch is numeric, preserving the
--      most-recent-first ordering.
--
-- get_worker_performance is intentionally omitted: this database's routes/jobs/
-- profiles schema does not carry the columns that version referenced
-- (routes.worker_id / actual_minutes / estimated_minutes, jobs.route_id,
-- profiles.name), so it needs a schema-specific rewrite before it can be added.

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
RETURNS TABLE(name TEXT, total_invoiced NUMERIC, total_paid NUMERIC, outstanding_balance NUMERIC, last_invoice_date DATE, invoice_count BIGINT)
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
    CASE WHEN sort_by = 'revenue' THEN COALESCE(SUM(i.total), 0)
         WHEN sort_by = 'outstanding' THEN COALESCE(SUM(i.total), 0) - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices inv ON p.invoice_id = inv.id WHERE inv.customer_id = c.id), 0)
         ELSE EXTRACT(EPOCH FROM MAX(i.issue_date))
    END DESC NULLS LAST
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
      COALESCE(e.amount, 0)
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
