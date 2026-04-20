-- Invoice Anomaly Detection tables

CREATE TABLE IF NOT EXISTS invoice_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN (
    'duplicate_suspected', 'amount_unusual', 'pricing_inconsistency',
    'customer_spend_change', 'vat_calculation_error', 'missing_vat',
    'unusual_payment_terms', 'duplicate_line_item'
  )),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  ai_reasoning TEXT,
  suggested_action TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  resolution_note TEXT,
  extra_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_anomalies_invoice ON invoice_anomalies(invoice_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_status ON invoice_anomalies(status, severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON invoice_anomalies(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomalies_created ON invoice_anomalies(created_at DESC);

-- RLS
ALTER TABLE invoice_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own anomalies" ON invoice_anomalies
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_anomalies.invoice_id AND i.profiles_id = auth.uid())
  );

CREATE POLICY "Users can update own anomalies" ON invoice_anomalies
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_anomalies.invoice_id AND i.profiles_id = auth.uid())
  );

CREATE POLICY "System can insert anomalies" ON invoice_anomalies
  FOR INSERT WITH CHECK (true);

-- Helper: Get customer average invoice
CREATE OR REPLACE FUNCTION get_customer_avg_invoice(cust_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  avg_amount NUMERIC;
BEGIN
  SELECT COALESCE(AVG(total), 0) INTO avg_amount
  FROM invoices
  WHERE customer_id = cust_id
    AND status IN ('sent', 'paid', 'overdue')
    AND created_at >= CURRENT_DATE - INTERVAL '12 months';
  RETURN avg_amount;
END;
$$;

-- Helper: Find potential duplicates
CREATE OR REPLACE FUNCTION find_duplicate_invoices(invoice_id UUID)
RETURNS TABLE(duplicate_id UUID, invoice_number TEXT, issue_date DATE, total NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT i2.id, i2.invoice_number, i2.issue_date, i2.total
  FROM invoices i1
  JOIN invoices i2 ON i2.customer_id = i1.customer_id
    AND i2.id != i1.id
    AND i2.total = i1.total
    AND i2.issue_date >= i1.issue_date - INTERVAL '7 days'
    AND i2.issue_date <= i1.issue_date + INTERVAL '7 days'
    AND i2.status NOT IN ('draft', 'cancelled')
  WHERE i1.id = invoice_id;
END;
$$;

-- Helper: Get historical price for comparison
CREATE OR REPLACE FUNCTION get_historical_price(cust_id UUID, desc_pattern TEXT)
RETURNS TABLE(unit_price NUMERIC, invoice_date DATE)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT il.unit_price, i.issue_date
  FROM invoice_line_items il
  JOIN invoices i ON i.id = il.invoice_id
  WHERE i.customer_id = cust_id
    AND i.status IN ('sent', 'paid')
    AND il.description ILIKE '%' || desc_pattern || '%'
  ORDER BY i.issue_date DESC
  LIMIT 1;
END;
$$;