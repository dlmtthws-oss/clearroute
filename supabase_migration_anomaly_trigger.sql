-- ============================================================
-- ClearRoute: Automatic Anomaly Detection Trigger
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Function to check anomalies after invoice insert/update
CREATE OR REPLACE FUNCTION check_invoice_anomalies()
RETURNS TRIGGER AS $$
BEGIN
  -- This function is called by the trigger, but we handle the actual
  -- anomaly checking in the Edge Function for better control
  -- This just records that a check is needed
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to fire after invoice insert/update
DROP TRIGGER IF EXISTS trigger_check_invoice_anomalies ON invoices;

CREATE TRIGGER trigger_check_invoice_anomalies
AFTER INSERT OR UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION check_invoice_anomalies();

-- Note: The actual anomaly checking logic runs in the Edge Function.
-- This trigger can be extended to call the edge function internally
-- or we can rely on the client-side trigger in InvoiceBuilder.

-- ── Create a view for easy anomaly summary ───────────────────────────────
CREATE OR REPLACE VIEW anomaly_summary AS
SELECT 
  re.anomaly_type,
  re.severity,
  re.status,
  COUNT(*) as count
FROM risk_events re
GROUP BY re.anomaly_type, re.severity, re.status;

-- ── Create a view for invoice risk overview ──────────────────────────────
CREATE OR REPLACE VIEW invoice_risk_overview AS
SELECT 
  i.id,
  i.invoice_number,
  i.issue_date,
  i.total,
  c.name as customer_name,
  COUNT(re.id) as anomaly_count,
  MAX(CASE WHEN re.severity = 'error' THEN 1 ELSE 0 END) as has_errors,
  MAX(CASE WHEN re.status = 'open' THEN 1 ELSE 0 END) as has_open_issues
FROM invoices i
LEFT JOIN customers c ON i.customer_id = c.id
LEFT JOIN risk_events re ON re.invoice_id = i.id
GROUP BY i.id, i.invoice_number, i.issue_date, i.total, c.name;

-- Done!