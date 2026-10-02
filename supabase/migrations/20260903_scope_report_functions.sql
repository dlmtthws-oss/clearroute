-- Scope Jarvis business-report functions to the caller's company
--
-- The report functions (get_revenue_summary / get_outstanding_invoices /
-- get_customer_summary / get_expense_summary) are SECURITY DEFINER and were
-- aggregating across ALL companies' data with no tenant filter, while also being
-- callable directly over the REST API by any signed-in user. This replaces each
-- with a version that filters on `current_company_id()` (the caller's company,
-- derived from their profile). Consequences:
--   * A signed-in user — directly or via the ai-assistant edge function calling
--     with their JWT — only ever sees their own company's figures.
--   * A service-role or anonymous call resolves company to NULL and therefore
--     returns no rows, rather than leaking every company's data.
-- Signatures are unchanged so this is a plain CREATE OR REPLACE (no drop), and
-- search_path is pinned. The ai-assistant edge function is updated in tandem to
-- invoke these as the signed-in user.

CREATE OR REPLACE FUNCTION get_revenue_summary(period TEXT, year_num INTEGER, month_num INTEGER)
RETURNS TABLE(total_revenue NUMERIC, invoice_count BIGINT, avg_invoice_value NUMERIC, previous_period_revenue NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company uuid := current_company_id();
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
      AND i.company_id = v_company
  ),
  previous AS (
    SELECT COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= (SELECT start_date - INTERVAL '1 month' FROM period_range)
      AND p.created_at < (SELECT start_date FROM period_range)
      AND i.status = 'paid'
      AND i.company_id = v_company
  )
  SELECT current.total, current.count::BIGINT, COALESCE(current.avg, 0), previous.total
  FROM current, previous;
END;
$$;

CREATE OR REPLACE FUNCTION get_outstanding_invoices(limit_num INTEGER DEFAULT 10, min_days INTEGER DEFAULT 0)
RETURNS TABLE(customer_name TEXT, amount NUMERIC, days_overdue INTEGER, invoice_number TEXT, due_date DATE)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company uuid := current_company_id();
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
    AND i.company_id = v_company
  ORDER BY amount DESC
  LIMIT limit_num;
END;
$$;

CREATE OR REPLACE FUNCTION get_customer_summary(customer_name TEXT, limit_num INTEGER DEFAULT 20, sort_by TEXT DEFAULT 'revenue')
RETURNS TABLE(name TEXT, total_invoiced NUMERIC, total_paid NUMERIC, outstanding_balance NUMERIC, last_invoice_date DATE, invoice_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company uuid := current_company_id();
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
  WHERE c.company_id = v_company
    AND ($1 IS NULL OR c.name ILIKE '%' || $1 || '%')
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
SET search_path = public, pg_temp
AS $$
DECLARE v_company uuid := current_company_id();
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
  WHERE e.company_id = v_company
    AND ($1 IS NULL OR e.expense_date >= CASE
      WHEN $1 = 'month' THEN DATE_TRUNC('month', CURRENT_DATE)
      WHEN $1 = 'quarter' THEN DATE_TRUNC('quarter', CURRENT_DATE)
      WHEN $1 = 'year' THEN DATE_TRUNC('year', CURRENT_DATE)
      ELSE CURRENT_DATE - INTERVAL '30 days'
    END)
    AND ($2 IS NULL OR e.category = $2);
END;
$$;
