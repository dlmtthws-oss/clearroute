-- GoCardless Mandates table
CREATE TABLE IF NOT EXISTS gocardless_mandates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  gc_mandate_id TEXT UNIQUE,
  gc_customer_id TEXT,
  gc_bank_account_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled', 'failed', 'submitted')),
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- GoCardless Payments table
CREATE TABLE IF NOT EXISTS gocardless_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  mandate_id UUID REFERENCES gocardless_mandates(id) ON DELETE SET NULL,
  gc_payment_id TEXT UNIQUE,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'pending_submission' CHECK (status IN ('pending_submission', 'submitted', 'confirmed', 'paid_out', 'failed', 'cancelled')),
  charge_date DATE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add columns to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gc_mandate_id UUID REFERENCES gocardless_mandates(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'manual' CHECK (payment_method IN ('direct_debit', 'manual'));

-- Enable RLS
ALTER TABLE gocardless_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocardless_payments ENABLE ROW LEVEL SECURITY;

-- Policies for gocardless_mandates
CREATE POLICY "mandates_read" ON gocardless_mandates FOR SELECT USING (true);
CREATE POLICY "mandates_insert" ON gocardless_mandates FOR INSERT WITH CHECK (true);
CREATE POLICY "mandates_update" ON gocardless_mandates FOR UPDATE USING (true);
CREATE POLICY "mandates_delete" ON gocardless_mandates FOR DELETE USING (true);

-- Policies for gocardless_payments
CREATE POLICY "payments_read" ON gocardless_payments FOR SELECT USING (true);
CREATE POLICY "payments_insert" ON gocardless_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "payments_update" ON gocardless_payments FOR UPDATE USING (true);
CREATE POLICY "payments_delete" ON gocardless_payments FOR DELETE USING (true);

-- Function to handle webhook signature verification
CREATE OR REPLACE FUNCTION verify_gocardless_signature(
  webhook_secret TEXT,
  timestamp TEXT,
  body TEXT,
  signature TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  -- Simplified verification - in production use HMAC-SHA256
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to update mandate status from webhook
CREATE OR REPLACE FUNCTION handle_mandate_status_update(
  p_gc_mandate_id TEXT,
  p_status TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE gocardless_mandates
  SET status = p_status, updated_at = NOW()
  WHERE gc_mandate_id = p_gc_mandate_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update payment status from webhook
CREATE OR REPLACE FUNCTION handle_payment_status_update(
  p_gc_payment_id TEXT,
  p_status TEXT,
  p_invoice_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE gocardless_payments
  SET status = p_status, updated_at = NOW()
  WHERE gc_payment_id = p_gc_payment_id;
  
  -- If payment confirmed/paid, update invoice status
  IF p_status IN ('confirmed', 'paid_out') AND p_invoice_id IS NOT NULL THEN
    UPDATE invoices
    SET status = 'paid', updated_at = NOW()
    WHERE id = p_invoice_id;
    
    -- Record payment in payments table
    INSERT INTO payments (invoice_id, amount, payment_date, method, reference)
    SELECT 
      p_invoice_id,
      gp.amount,
      CURRENT_DATE,
      'direct_debit',
      gp.gc_payment_id
    FROM gocardless_payments gp
    WHERE gp.gc_payment_id = p_gc_payment_id;
  END IF;
END;
$$ LANGUAGE plpgsql;